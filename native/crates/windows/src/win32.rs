//! Safe wrappers over the display calls the backend needs (user32 / gdi32).
//!
//! Everything here talks to the real machine, so it is exercised by running the helper, not by
//! unit tests. The decisions that feed these calls live in [`crate::plan`].

use std::iter::once;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use std::sync::Once;

use windows_sys::Win32::Devices::Display::{
    DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_HEADER,
    DISPLAYCONFIG_DEVICE_INFO_TYPE, DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO,
    DISPLAYCONFIG_SOURCE_DEVICE_NAME, DisplayConfigGetDeviceInfo, DisplayConfigSetDeviceInfo,
    GetDisplayConfigBufferSizes, QDC_ONLY_ACTIVE_PATHS, QueryDisplayConfig, SDC_APPLY,
    SDC_TOPOLOGY_EXTEND, SetDisplayConfig,
};
use windows_sys::Win32::Foundation::{LUID, POINT};
use windows_sys::Win32::Graphics::Gdi::{
    CDS_NORESET, CDS_TEST, CDS_UPDATEREGISTRY, ChangeDisplaySettingsExW, DEVMODEW,
    DISP_CHANGE_SUCCESSFUL, DISPLAY_DEVICE_ACTIVE, DISPLAY_DEVICE_ATTACHED_TO_DESKTOP,
    DISPLAY_DEVICE_PRIMARY_DEVICE, DISPLAY_DEVICEW, DM_BITSPERPEL, DM_DISPLAYFREQUENCY,
    DM_PELSHEIGHT, DM_PELSWIDTH, DM_POSITION, ENUM_CURRENT_SETTINGS, EnumDisplayDevicesW,
    EnumDisplaySettingsW, MONITOR_DEFAULTTONEAREST, MonitorFromPoint,
};

use crate::plan;
use windows_sys::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForMonitor, MDT_EFFECTIVE_DPI,
    SetProcessDpiAwarenessContext,
};

/// One display output (a GDI source) Windows knows about, attached to the desktop or not.
#[derive(Debug, Clone)]
pub struct Adapter {
    /// GDI device name such as `\\.\DISPLAY7`. It changes when the driver restarts, so it is
    /// looked up fresh for every operation and never cached.
    pub device_name: String,
    /// The graphics adapter's description, e.g. `Virtual Display Driver`.
    pub description: String,
    /// The graphics adapter's device id, e.g. `Root\MttVDD` or `PCI\VEN_8086&...`.
    pub device_id: String,
    /// The first monitor's friendly name, e.g. `Generic PnP Monitor`; empty if none.
    pub monitor_name: String,
    /// Every monitor showing this output's picture: more than one when displays are cloned
    /// (Windows' "Duplicate these displays"). `(device id, active)`.
    pub monitors: Vec<(String, bool)>,
    pub attached: bool,
    pub primary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurrentMode {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub hz: u32,
}

fn to_wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(once(0)).collect()
}

fn from_wide(buffer: &[u16]) -> String {
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len])
}

fn empty_devmode() -> DEVMODEW {
    // SAFETY: DEVMODEW is plain old data and all-zero is a valid value for it.
    let mut mode: DEVMODEW = unsafe { zeroed() };
    mode.dmSize = u16::try_from(size_of::<DEVMODEW>()).unwrap_or(u16::MAX);
    mode
}

fn empty_device() -> DISPLAY_DEVICEW {
    // SAFETY: DISPLAY_DEVICEW is plain old data and all-zero is a valid value for it.
    let mut device: DISPLAY_DEVICEW = unsafe { zeroed() };
    device.cb = u32::try_from(size_of::<DISPLAY_DEVICEW>()).unwrap_or(u32::MAX);
    device
}

/// Every display output, in Windows' own enumeration order.
pub fn adapters() -> Vec<Adapter> {
    let mut found = Vec::new();
    for index in 0..64 {
        let mut device = empty_device();
        // SAFETY: `device` is a valid, correctly sized DISPLAY_DEVICEW; a null name asks for
        // the adapter at `index`.
        if unsafe { EnumDisplayDevicesW(null(), index, &raw mut device, 0) } == 0 {
            break;
        }
        let mut monitors = Vec::new();
        let mut monitor_name = String::new();
        for monitor_index in 0..8 {
            let mut monitor = empty_device();
            // SAFETY: `device.DeviceName` is NUL-terminated and `monitor` is valid.
            let found_one = unsafe {
                EnumDisplayDevicesW(
                    device.DeviceName.as_ptr(),
                    monitor_index,
                    &raw mut monitor,
                    0,
                )
            } != 0;
            if !found_one {
                break;
            }
            if monitors.is_empty() {
                monitor_name = from_wide(&monitor.DeviceString);
            }
            monitors.push((
                from_wide(&monitor.DeviceID),
                monitor.StateFlags & DISPLAY_DEVICE_ACTIVE != 0,
            ));
        }
        found.push(Adapter {
            device_name: from_wide(&device.DeviceName),
            description: from_wide(&device.DeviceString),
            device_id: from_wide(&device.DeviceID),
            monitor_name,
            monitors,
            attached: device.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP != 0,
            primary: device.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE != 0,
        });
    }
    found
}

/// True while Windows shows the virtual monitor as a copy of another display ("Duplicate these
/// displays"): its monitor is then active under another adapter's output, and the virtual
/// monitor cannot extend the desktop.
pub fn virtual_monitor_cloned() -> bool {
    adapters().iter().any(|adapter| {
        !plan::is_virtual_display(&adapter.description, &adapter.device_id)
            && adapter
                .monitors
                .iter()
                .any(|(id, active)| *active && plan::is_virtual_monitor_id(id))
    })
}

/// Switches Windows to "Extend these displays", what Windows+P > Extend does.
pub fn extend_desktop() -> Result<(), String> {
    // SAFETY: no path or mode arrays are passed; the topology flag tells Windows what to apply.
    let code = unsafe { SetDisplayConfig(0, null(), 0, null(), SDC_APPLY | SDC_TOPOLOGY_EXTEND) };
    if code == 0 {
        Ok(())
    } else {
        Err(format!("SetDisplayConfig returned {code}"))
    }
}

fn read_position(mode: &DEVMODEW) -> (i32, i32) {
    // SAFETY: for display devices Windows fills the position member of this union.
    unsafe {
        let position = mode.Anonymous1.Anonymous2.dmPosition;
        (position.x, position.y)
    }
}

/// The mode a display is running now, or `None` when it is not on the desktop.
pub fn current_mode(device: &str) -> Option<CurrentMode> {
    let name = to_wide(device);
    let mut mode = empty_devmode();
    // SAFETY: `name` is NUL-terminated and `mode` is a valid DEVMODEW with dmSize set.
    if unsafe { EnumDisplaySettingsW(name.as_ptr(), ENUM_CURRENT_SETTINGS, &raw mut mode) } == 0 {
        return None;
    }
    if mode.dmPelsWidth == 0 || mode.dmPelsHeight == 0 {
        return None;
    }
    let (x, y) = read_position(&mode);
    Some(CurrentMode {
        x,
        y,
        width: mode.dmPelsWidth,
        height: mode.dmPelsHeight,
        hz: mode.dmDisplayFrequency,
    })
}

/// Every `(width, height, hz)` the driver currently offers for a display.
pub fn supported_modes(device: &str) -> Vec<(u32, u32, u32)> {
    let name = to_wide(device);
    let mut modes = Vec::new();
    for index in 0..4096 {
        let mut mode = empty_devmode();
        // SAFETY: as in `current_mode`; `index` walks the driver's mode table.
        if unsafe { EnumDisplaySettingsW(name.as_ptr(), index, &raw mut mode) } == 0 {
            break;
        }
        let entry = (mode.dmPelsWidth, mode.dmPelsHeight, mode.dmDisplayFrequency);
        if !modes.contains(&entry) {
            modes.push(entry);
        }
    }
    modes
}

fn describe(code: i32) -> String {
    let what = match code {
        1 => "a restart is required",
        -1 => "the driver failed to apply the mode",
        -2 => "the driver does not offer that mode",
        -3 => "the settings could not be written",
        -4 => "invalid flags",
        -5 => "invalid parameters",
        -6 => "the display configuration is not valid",
        _ => "unknown error",
    };
    format!("{what} (ChangeDisplaySettingsEx returned {code})")
}

fn check(code: i32) -> Result<(), String> {
    if code == DISP_CHANGE_SUCCESSFUL {
        Ok(())
    } else {
        Err(describe(code))
    }
}

/// A mode request built from the display's current settings, so fields we do not care about
/// keep the values Windows already uses.
fn requested(device: &[u16], width: u32, height: u32, hz: u32, x: i32, y: i32) -> DEVMODEW {
    let mut mode = empty_devmode();
    // SAFETY: as in `current_mode`. A failure leaves the zeroed template, which is fine.
    unsafe { EnumDisplaySettingsW(device.as_ptr(), ENUM_CURRENT_SETTINGS, &raw mut mode) };
    mode.dmPelsWidth = width;
    mode.dmPelsHeight = height;
    mode.dmDisplayFrequency = hz;
    mode.dmBitsPerPel = 32;
    // Writing a plain-data union member is safe; this is the display variant's position.
    mode.Anonymous1.Anonymous2.dmPosition.x = x;
    mode.Anonymous1.Anonymous2.dmPosition.y = y;
    mode.dmFields |=
        DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY | DM_BITSPERPEL | DM_POSITION;
    mode
}

fn change(device: Option<&[u16]>, mode: Option<&DEVMODEW>, flags: u32) -> i32 {
    let device_ptr = device.map_or(null(), <[u16]>::as_ptr);
    let mode_ptr = mode.map_or(null(), std::ptr::from_ref);
    // SAFETY: `device_ptr` is null (the global commit) or NUL-terminated, and `mode_ptr` is
    // null or points at a valid DEVMODEW that outlives the call.
    unsafe { ChangeDisplaySettingsExW(device_ptr, mode_ptr, null_mut(), flags, null()) }
}

/// Switches a display that is already on the desktop to another size the driver offers.
/// Dynamic: nothing is written to the registry, and no restart is needed.
pub fn set_mode_live(
    device: &str,
    width: u32,
    height: u32,
    hz: u32,
    x: i32,
    y: i32,
) -> Result<(), String> {
    let name = to_wide(device);
    let mode = requested(&name, width, height, hz, x, y);
    check(change(Some(&name), Some(&mode), CDS_TEST))?;
    check(change(Some(&name), Some(&mode), 0))
}

/// Puts a display that is not on the desktop onto it at the given place and mode.
///
/// Unlike [`set_mode_live`] there is no `CDS_TEST` first: Windows answers `DISP_CHANGE_FAILED`
/// to a test of a display that is not part of the current desktop, so the mode is queued
/// and committed directly. The caller has already checked the driver offers it.
pub fn attach_persistent(
    device: &str,
    width: u32,
    height: u32,
    hz: u32,
    x: i32,
    y: i32,
) -> Result<(), String> {
    let name = to_wide(device);
    let mode = requested(&name, width, height, hz, x, y);
    check(change(
        Some(&name),
        Some(&mode),
        CDS_UPDATEREGISTRY | CDS_NORESET,
    ))
    .map_err(|e| format!("register step: {e}"))?;
    commit().map_err(|e| format!("commit step: {e}"))
}

/// Takes a display off the desktop. Windows moves its windows back to the remaining screens.
pub fn detach_persistent(device: &str, x: i32, y: i32) -> Result<(), String> {
    let name = to_wide(device);
    let mut mode = empty_devmode();
    mode.dmFields = DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT;
    mode.Anonymous1.Anonymous2.dmPosition.x = x;
    mode.Anonymous1.Anonymous2.dmPosition.y = y;
    check(change(
        Some(&name),
        Some(&mode),
        CDS_UPDATEREGISTRY | CDS_NORESET,
    ))?;
    commit()
}

/// Applies the changes queued with `CDS_NORESET`.
fn commit() -> Result<(), String> {
    check(change(None, None, 0))
}

/// The OS scale factor of the monitor at this rectangle (1.0 = 100%).
pub fn scale_factor(x: i32, y: i32, width: u32, height: u32) -> f64 {
    static AWARE: Once = Once::new();
    AWARE.call_once(|| {
        // Without this the helper is DPI-unaware and the answer below is always 96 DPI.
        // SAFETY: a plain call with a documented constant; failure (already set) is harmless.
        unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    });
    let centre = POINT {
        x: x.saturating_add(i32::try_from(width / 2).unwrap_or(0)),
        y: y.saturating_add(i32::try_from(height / 2).unwrap_or(0)),
    };
    // SAFETY: plain value arguments; the returned handle is only passed straight back.
    let monitor = unsafe { MonitorFromPoint(centre, MONITOR_DEFAULTTONEAREST) };
    let (mut dpi_x, mut dpi_y) = (0_u32, 0_u32);
    // SAFETY: both out-pointers are valid for the call.
    let result =
        unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &raw mut dpi_x, &raw mut dpi_y) };
    if result == 0 && dpi_x > 0 {
        f64::from(dpi_x) / 96.0
    } else {
        1.0
    }
}

// ---------------------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------------------

/// Windows' own requests for a display source's scale, the ones Settings > Display > Scale makes.
/// They aren't documented, but every per-monitor scaling tool uses them: get answers how many
/// steps the current, smallest and largest allowed scales are from the recommended one, and set
/// moves the scale to a number of steps from it.
const DPI_SCALE_GET: DISPLAYCONFIG_DEVICE_INFO_TYPE = -3;
const DPI_SCALE_SET: DISPLAYCONFIG_DEVICE_INFO_TYPE = -4;

#[repr(C)]
struct DpiScaleGet {
    header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
    min_rel: i32,
    current_rel: i32,
    max_rel: i32,
}

#[repr(C)]
struct DpiScaleSet {
    header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
    rel: i32,
}

fn info_header(
    kind: DISPLAYCONFIG_DEVICE_INFO_TYPE,
    size: usize,
    adapter: LUID,
    id: u32,
) -> DISPLAYCONFIG_DEVICE_INFO_HEADER {
    DISPLAYCONFIG_DEVICE_INFO_HEADER {
        r#type: kind,
        size: u32::try_from(size).unwrap_or(0),
        adapterId: adapter,
        id,
    }
}

/// The `DisplayConfig` source showing this GDI device (`\\.\DISPLAY7`): its adapter and id.
fn display_source(device: &str) -> Option<(LUID, u32)> {
    let (mut path_count, mut mode_count) = (0_u32, 0_u32);
    // SAFETY: both out-pointers are valid for the call.
    let code = unsafe {
        GetDisplayConfigBufferSizes(
            QDC_ONLY_ACTIVE_PATHS,
            &raw mut path_count,
            &raw mut mode_count,
        )
    };
    if code != 0 {
        return None;
    }
    // SAFETY: all-zero path and mode structs are valid empty values; Windows fills them in.
    let mut paths: Vec<DISPLAYCONFIG_PATH_INFO> =
        vec![unsafe { zeroed() }; usize::try_from(path_count).unwrap_or(0)];
    // SAFETY: as above.
    let mut modes: Vec<DISPLAYCONFIG_MODE_INFO> =
        vec![unsafe { zeroed() }; usize::try_from(mode_count).unwrap_or(0)];
    // SAFETY: each array holds as many elements as its count says; no topology id is wanted.
    let code = unsafe {
        QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &raw mut path_count,
            paths.as_mut_ptr(),
            &raw mut mode_count,
            modes.as_mut_ptr(),
            null_mut(),
        )
    };
    if code != 0 {
        return None;
    }
    paths.truncate(usize::try_from(path_count).unwrap_or(0));
    paths.iter().find_map(|path| {
        let (adapter, id) = (path.sourceInfo.adapterId, path.sourceInfo.id);
        // SAFETY: an all-zero name struct is a valid empty value.
        let mut name: DISPLAYCONFIG_SOURCE_DEVICE_NAME = unsafe { zeroed() };
        name.header = info_header(
            DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
            size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>(),
            adapter,
            id,
        );
        // SAFETY: the header starts the struct and its size covers all of it.
        let code = unsafe { DisplayConfigGetDeviceInfo((&raw mut name).cast()) };
        (code == 0 && from_wide(&name.viewGdiDeviceName).eq_ignore_ascii_case(device))
            .then_some((adapter, id))
    })
}

/// Sets the scale of the display showing `device` to the step nearest `percent`, within what
/// Windows allows for that display, and returns the percent it has now.
pub fn set_scale(device: &str, percent: u32) -> Result<u32, String> {
    let (adapter, id) =
        display_source(device).ok_or_else(|| format!("{device} is not on the desktop"))?;
    let mut get = DpiScaleGet {
        header: info_header(DPI_SCALE_GET, size_of::<DpiScaleGet>(), adapter, id),
        min_rel: 0,
        current_rel: 0,
        max_rel: 0,
    };
    // SAFETY: the header starts the struct and its size covers all of it.
    let code = unsafe { DisplayConfigGetDeviceInfo((&raw mut get).cast()) };
    if code != 0 {
        return Err(format!("reading its scale failed ({code})"));
    }
    let rel = plan::scale_steps(percent, get.min_rel, get.max_rel);
    if rel != get.current_rel {
        let set = DpiScaleSet {
            header: info_header(DPI_SCALE_SET, size_of::<DpiScaleSet>(), adapter, id),
            rel,
        };
        // SAFETY: as above; Windows only reads it.
        let code = unsafe { DisplayConfigSetDeviceInfo((&raw const set).cast()) };
        if code != 0 {
            return Err(format!("setting its scale failed ({code})"));
        }
    }
    Ok(plan::scale_percent(rel, get.min_rel))
}
