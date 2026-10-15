//! Safe wrappers over the display calls the backend needs (user32 / gdi32).
//!
//! Everything here talks to the real machine, so it is exercised by running the helper, not by
//! unit tests. The decisions that feed these calls live in [`crate::plan`].

use std::iter::once;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use std::sync::Once;

use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::Graphics::Gdi::{
    CDS_NORESET, CDS_TEST, CDS_UPDATEREGISTRY, ChangeDisplaySettingsExW, DEVMODEW,
    DISP_CHANGE_SUCCESSFUL, DISPLAY_DEVICE_ATTACHED_TO_DESKTOP, DISPLAY_DEVICE_PRIMARY_DEVICE,
    DISPLAY_DEVICEW, DM_BITSPERPEL, DM_DISPLAYFREQUENCY, DM_PELSHEIGHT, DM_PELSWIDTH, DM_POSITION,
    ENUM_CURRENT_SETTINGS, EnumDisplayDevicesW, EnumDisplaySettingsW, MONITOR_DEFAULTTONEAREST,
    MonitorFromPoint,
};
use windows_sys::Win32::UI::HiDpi::{
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForMonitor, MDT_EFFECTIVE_DPI,
    SetProcessDpiAwarenessContext,
};

/// One display output Windows knows about, attached to the desktop or not.
#[derive(Debug, Clone)]
pub struct Adapter {
    /// GDI device name such as `\\.\DISPLAY7`. It changes when the driver restarts, so it is
    /// looked up fresh for every operation and never cached.
    pub device_name: String,
    /// The graphics adapter's description, e.g. `Virtual Display Driver`.
    pub description: String,
    /// The attached monitor's device id, e.g. `MONITOR\MTT1337\{...}\0006`; empty if none.
    pub monitor_id: String,
    /// The monitor's friendly name, e.g. `Generic PnP Monitor`; empty if none.
    pub monitor_name: String,
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
        let mut monitor = empty_device();
        // SAFETY: `device.DeviceName` is NUL-terminated and `monitor` is valid.
        let has_monitor =
            unsafe { EnumDisplayDevicesW(device.DeviceName.as_ptr(), 0, &raw mut monitor, 0) } != 0;
        found.push(Adapter {
            device_name: from_wide(&device.DeviceName),
            description: from_wide(&device.DeviceString),
            monitor_id: if has_monitor {
                from_wide(&monitor.DeviceID)
            } else {
                String::new()
            },
            monitor_name: if has_monitor {
                from_wide(&monitor.DeviceString)
            } else {
                String::new()
            },
            attached: device.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP != 0,
            primary: device.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE != 0,
        });
    }
    found
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
