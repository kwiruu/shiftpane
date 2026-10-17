//! The one step that needs administrator rights: adding resolutions to the driver's settings
//! file and restarting the driver so it reloads them.
//!
//! The helper itself never runs elevated. When a size is missing it starts a second copy of
//! itself through a UAC prompt with a fixed sub-command, `apply-modes WIDTH HEIGHT ...`. That
//! copy accepts nothing but plain numbers (see [`crate::plan::parse_mode_args`]), edits the
//! list, restarts the driver and exits, so it cannot be steered into running anything else.

use std::fmt::Write as _;
use std::fs;
use std::iter::once;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};
use std::thread::sleep;
use std::time::{Duration, Instant};

use shiftpane_core::protocol::{ErrorCode, HelperError};
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    DICS_FLAG_GLOBAL, DICS_PROPCHANGE, DIF_PROPERTYCHANGE, DIGCF_PRESENT, SP_DEVINFO_DATA,
    SP_PROPCHANGE_PARAMS, SPDRP_HARDWAREID, SetupDiCallClassInstaller,
    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW,
    SetupDiGetDeviceRegistryPropertyW, SetupDiSetClassInstallParamsW,
};
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_CANCELLED, GetLastError, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
};
use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
use windows_sys::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
use windows_sys::core::GUID;

use crate::DEFAULT_SETTINGS_PATH;
use crate::plan::{self, exit};
use crate::{settings, win32};

/// How long to wait for the user to answer the UAC prompt and the driver to restart.
const ELEVATED_STEP_TIMEOUT_MS: u32 = 120_000;

/// `GUID_DEVCLASS_DISPLAY`: the device class the driver's node belongs to.
const DISPLAY_CLASS: GUID = GUID {
    data1: 0x4d36_e968,
    data2: 0xe325,
    data3: 0x11ce,
    data4: [0xbf, 0xc1, 0x08, 0x00, 0x2b, 0xe1, 0x03, 0x18],
};

fn internal(message: impl Into<String>) -> HelperError {
    HelperError::new(ErrorCode::Internal, message)
}

/// Asks Windows to run `shiftpane-helper apply-modes ...` elevated and waits for it.
pub fn add_modes(sizes: &[(u32, u32)]) -> Result<(), HelperError> {
    let exe = std::env::current_exe()
        .map_err(|e| internal(format!("cannot locate the helper executable: {e}")))?;
    let mut parameters = String::from("apply-modes");
    for (width, height) in sizes {
        // Writing to a String cannot fail.
        let _ = write!(parameters, " {width} {height}");
    }

    let verb: Vec<u16> = "runas".encode_utf16().chain(once(0)).collect();
    let file: Vec<u16> = exe.as_os_str().encode_wide().chain(once(0)).collect();
    let params: Vec<u16> = parameters.encode_utf16().chain(once(0)).collect();

    // SAFETY: SHELLEXECUTEINFOW is plain old data; all-zero is a valid starting value.
    let mut info: SHELLEXECUTEINFOW = unsafe { zeroed() };
    info.cbSize = u32::try_from(size_of::<SHELLEXECUTEINFOW>()).unwrap_or(u32::MAX);
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params.as_ptr();
    info.nShow = SW_HIDE;

    tracing::info!(%parameters, "asking for administrator approval to add display modes");
    // SAFETY: `info` is fully initialised and the three wide strings outlive the call.
    if unsafe { ShellExecuteExW(&raw mut info) } == 0 {
        // SAFETY: reads the calling thread's last error.
        let code = unsafe { GetLastError() };
        return Err(if code == ERROR_CANCELLED {
            HelperError::new(
                ErrorCode::PermissionDenied,
                "Administrator approval was declined, so the new display size could not be added",
            )
        } else {
            internal(format!(
                "could not start the elevated step (Windows error {code})"
            ))
        });
    }
    let process = info.hProcess;
    if process.is_null() {
        return Err(internal(
            "the elevated step did not return a process to wait for",
        ));
    }

    // SAFETY: `process` is a valid process handle we own.
    let waited = unsafe { WaitForSingleObject(process, ELEVATED_STEP_TIMEOUT_MS) };
    let mut code = 0_u32;
    // SAFETY: `process` is valid and `code` is a valid out-pointer.
    let got_code = unsafe { GetExitCodeProcess(process, &raw mut code) } != 0;
    // SAFETY: closes the handle ShellExecuteExW gave us exactly once.
    unsafe { CloseHandle(process) };

    if waited != WAIT_OBJECT_0 {
        return Err(internal("the elevated step did not finish in time"));
    }
    if !got_code {
        return Err(internal("could not read the elevated step's result"));
    }
    match i32::try_from(code).unwrap_or(i32::MAX) {
        exit::OK => Ok(()),
        exit::BAD_ARGS => Err(internal("the elevated step rejected its arguments")),
        exit::SETTINGS => Err(internal(format!(
            "the elevated step could not update {DEFAULT_SETTINGS_PATH}"
        ))),
        exit::NO_DEVICE => Err(HelperError::new(
            ErrorCode::BackendUnavailable,
            "the Virtual Display Driver device was not found",
        )),
        exit::RESTART_FAILED => Err(internal(
            "the Virtual Display Driver could not be restarted",
        )),
        exit::REJECTED => Err(internal(
            "the Virtual Display Driver did not accept the new size list, so the previous list \
             was put back and nothing changed",
        )),
        exit::TOO_MANY => Err(HelperError::invalid_params(format!(
            "the driver's size list holds at most {} sizes",
            plan::MAX_LISTED_RESOLUTIONS
        ))),
        other => Err(internal(format!(
            "the elevated step failed with code {other}"
        ))),
    }
}

/// How long the elevated copy waits for the restarted driver to offer the new sizes.
const VERIFY_TIMEOUT: Duration = Duration::from_secs(25);

/// Entry point of the elevated copy. Returns the process exit code.
///
/// The driver gives no error when it dislikes a size list: the monitor just disappears. So the
/// new list is checked after the restart, and the old one is put back if the monitor does not
/// come back offering the new sizes.
pub fn run(args: &[String]) -> i32 {
    let Ok(sizes) = plan::parse_mode_args(args) else {
        return exit::BAD_ARGS;
    };
    let path = Path::new(DEFAULT_SETTINGS_PATH);
    let Ok(before) = fs::read_to_string(path) else {
        return exit::SETTINGS;
    };
    let Ok(updated) = settings::with_modes(&before, &sizes) else {
        return exit::SETTINGS;
    };
    if updated.is_some() {
        let listed = settings::listed_resolutions(&before);
        if plan::list_len_after(&listed, &sizes) > plan::MAX_LISTED_RESOLUTIONS {
            return exit::TOO_MANY;
        }
    }
    if let Some(new_xml) = &updated
        && write_atomic(path, new_xml).is_err()
    {
        return exit::SETTINGS;
    }

    // Always restart, even when the file already had the sizes: the caller only gets here
    // because the running driver does not offer them, e.g. after an earlier restart failed.
    let restarted = restart_driver();
    if restarted.is_ok() && driver_offers(&sizes) {
        return exit::OK;
    }

    // Put the old list back so the monitor returns instead of staying missing.
    if updated.is_some() && write_atomic(path, &before).is_ok() {
        let _ = restart_driver();
    }
    match restarted {
        Ok(()) => exit::REJECTED,
        Err(code) => code,
    }
}

/// Writes beside the file and renames, so the driver never reads a half-written list.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let temp = path.with_extension("xml.shiftpane-tmp");
    fs::write(&temp, contents).map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })
}

/// Waits for the virtual monitor to be present and offering every size in `wanted`.
fn driver_offers(wanted: &[(u32, u32)]) -> bool {
    let deadline = Instant::now() + VERIFY_TIMEOUT;
    loop {
        let offered = win32::adapters()
            .into_iter()
            .find(|a| plan::is_virtual_display(&a.description, &a.device_id))
            .map(|a| win32::supported_modes(&a.device_name))
            .unwrap_or_default();
        if !offered.is_empty() && plan::missing_sizes(&offered, wanted).is_empty() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(Duration::from_millis(300));
    }
}

/// Restarts the Virtual Display Driver's device node so it re-reads `vdd_settings.xml`.
/// This is `DICS_PROPCHANGE`, the same operation as `pnputil /restart-device`.
fn restart_driver() -> Result<(), i32> {
    // SAFETY: a plain query for present devices of the display class.
    let set = unsafe { SetupDiGetClassDevsW(&DISPLAY_CLASS, null(), null_mut(), DIGCF_PRESENT) };
    // HDEVINFO is an integer handle; the failure value is INVALID_HANDLE_VALUE (-1).
    if set == INVALID_HANDLE_VALUE as isize {
        return Err(exit::RESTART_FAILED);
    }
    let result = restart_in_set(set);
    // SAFETY: `set` is the valid device information set created above.
    unsafe { SetupDiDestroyDeviceInfoList(set) };
    result
}

fn restart_in_set(
    set: windows_sys::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
) -> Result<(), i32> {
    for index in 0.. {
        // SAFETY: SP_DEVINFO_DATA is plain old data; cbSize is set before use.
        let mut data: SP_DEVINFO_DATA = unsafe { zeroed() };
        data.cbSize = u32::try_from(size_of::<SP_DEVINFO_DATA>()).unwrap_or(u32::MAX);
        // SAFETY: `set` is valid and `data` is a correctly sized out-parameter.
        if unsafe { SetupDiEnumDeviceInfo(set, index, &raw mut data) } == 0 {
            break;
        }
        if has_driver_hardware_id(set, &data) {
            return property_change(set, &data);
        }
    }
    Err(exit::NO_DEVICE)
}

fn has_driver_hardware_id(
    set: windows_sys::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
    data: &SP_DEVINFO_DATA,
) -> bool {
    let mut buffer = [0_u16; 1024];
    let mut required = 0_u32;
    let byte_len = u32::try_from(size_of::<[u16; 1024]>()).unwrap_or(u32::MAX);
    // SAFETY: `buffer` is valid for `byte_len` bytes and the out-pointers are valid.
    let ok = unsafe {
        SetupDiGetDeviceRegistryPropertyW(
            set,
            data,
            SPDRP_HARDWAREID,
            null_mut(),
            buffer.as_mut_ptr().cast::<u8>(),
            byte_len,
            &raw mut required,
        )
    };
    if ok == 0 {
        return false;
    }
    // The property is a REG_MULTI_SZ: NUL-separated strings ending with an empty one.
    buffer
        .split(|&c| c == 0)
        .take_while(|part| !part.is_empty())
        .any(|part| plan::is_driver_hardware_id(&String::from_utf16_lossy(part)))
}

fn property_change(
    set: windows_sys::Win32::Devices::DeviceAndDriverInstallation::HDEVINFO,
    data: &SP_DEVINFO_DATA,
) -> Result<(), i32> {
    // SAFETY: SP_PROPCHANGE_PARAMS is plain old data and all-zero is a valid start.
    let mut params: SP_PROPCHANGE_PARAMS = unsafe { zeroed() };
    params.ClassInstallHeader.cbSize = u32::try_from(size_of::<
        windows_sys::Win32::Devices::DeviceAndDriverInstallation::SP_CLASSINSTALL_HEADER,
    >())
    .unwrap_or(u32::MAX);
    params.ClassInstallHeader.InstallFunction = DIF_PROPERTYCHANGE;
    params.StateChange = DICS_PROPCHANGE;
    params.Scope = DICS_FLAG_GLOBAL;
    params.HwProfile = 0;
    let size = u32::try_from(size_of::<SP_PROPCHANGE_PARAMS>()).unwrap_or(u32::MAX);
    // SAFETY: `params` is fully initialised and its header is its first member.
    let set_ok = unsafe {
        SetupDiSetClassInstallParamsW(set, data, &raw const params.ClassInstallHeader, size)
    };
    if set_ok == 0 {
        return Err(exit::RESTART_FAILED);
    }
    // SAFETY: parameters were registered for this device just above.
    let called = unsafe { SetupDiCallClassInstaller(DIF_PROPERTYCHANGE, set, data) };
    if called == 0 {
        return Err(exit::RESTART_FAILED);
    }
    Ok(())
}
