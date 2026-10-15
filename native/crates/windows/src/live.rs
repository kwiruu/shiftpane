//! The Windows implementation behind [`crate::VddBackend`]: list, attach and detach against
//! the real machine, built from the safe wrappers in [`crate::win32`] and the one elevated
//! step in [`crate::elevated`].

use std::thread::sleep;
use std::time::{Duration, Instant};

use shiftpane_core::Mode;
use shiftpane_core::protocol::{DisplayInfo, ErrorCode, HelperError};

use crate::win32::{self, Adapter, CurrentMode};
use crate::{elevated, plan};

/// After restarting the driver, how long to wait for it to list the new size.
const RELOAD_TIMEOUT: Duration = Duration::from_secs(20);
/// After asking Windows to change a mode, how long to wait for it to show up.
const APPLY_TIMEOUT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(150);

fn internal(message: impl Into<String>) -> HelperError {
    HelperError::new(ErrorCode::Internal, message)
}

fn driver_missing() -> HelperError {
    HelperError::new(
        ErrorCode::BackendUnavailable,
        "the Virtual Display Driver's monitor is not present; is the driver installed and enabled?",
    )
}

/// The driver's display output. Looked up on every call because its device name changes
/// whenever the driver restarts.
fn find_virtual() -> Option<Adapter> {
    win32::adapters()
        .into_iter()
        .find(|a| plan::is_virtual_display(&a.description, &a.monitor_id))
}

fn to_info(adapter: &Adapter, mode: CurrentMode) -> DisplayInfo {
    DisplayInfo {
        id: adapter.device_name.clone(),
        name: if adapter.monitor_name.is_empty() {
            adapter.description.clone()
        } else {
            adapter.monitor_name.clone()
        },
        x: mode.x,
        y: mode.y,
        width: mode.width,
        height: mode.height,
        refresh_hz: mode.hz,
        scale_factor: win32::scale_factor(mode.x, mode.y, mode.width, mode.height),
        primary: adapter.primary,
        virtual_display: plan::is_virtual_display(&adapter.description, &adapter.monitor_id),
    }
}

// Listing cannot fail on Windows, but the signature matches the stand-in used on other OSes.
#[allow(clippy::unnecessary_wraps)]
pub fn list_displays() -> Result<Vec<DisplayInfo>, HelperError> {
    Ok(win32::adapters()
        .iter()
        .filter(|a| a.attached)
        .filter_map(|a| win32::current_mode(&a.device_name).map(|m| to_info(a, m)))
        .collect())
}

/// Polls `check` until it returns a value or the timeout passes.
fn wait_for<T>(timeout: Duration, mut check: impl FnMut() -> Option<T>) -> Option<T> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(value) = check() {
            return Some(value);
        }
        if Instant::now() >= deadline {
            return None;
        }
        sleep(POLL);
    }
}

fn offers_size(adapter: &Adapter, width: u32, height: u32) -> bool {
    win32::supported_modes(&adapter.device_name)
        .iter()
        .any(|&(w, h, _)| (w, h) == (width, height))
}

pub fn attach(mode: Mode) -> Result<DisplayInfo, HelperError> {
    if mode.scale_percent.is_some() {
        return Err(HelperError::unsupported(
            "per-monitor scaling is not implemented on Windows yet",
        ));
    }
    let (width, height) = (mode.width, mode.height);

    // 1. Make sure the driver offers this size; adding it is the only step that needs UAC.
    let adapter = find_virtual().ok_or_else(driver_missing)?;
    if !offers_size(&adapter, width, height) {
        elevated::add_modes(&[(width, height)])?;
        wait_for(RELOAD_TIMEOUT, || {
            find_virtual().filter(|a| offers_size(a, width, height))
        })
        .ok_or_else(|| {
            internal(format!(
                "the driver was restarted but still does not offer {width}x{height}"
            ))
        })?;
    }

    // 2. The device name may have changed with the restart, so look it up again.
    let adapter = find_virtual().ok_or_else(driver_missing)?;
    let rates: Vec<u32> = win32::supported_modes(&adapter.device_name)
        .into_iter()
        .filter(|&(w, h, _)| (w, h) == (width, height))
        .map(|(_, _, hz)| hz)
        .collect();
    let hz = plan::pick_refresh(&rates, mode.refresh_hz).ok_or_else(|| {
        internal(format!(
            "the driver offers no refresh rate for {width}x{height}"
        ))
    })?;

    // 3. Switch the mode in place if the display is on the desktop, or bring it back on.
    if let Some(current) = win32::current_mode(&adapter.device_name) {
        if (current.width, current.height, current.hz) != (width, height, hz) {
            win32::set_mode_live(
                &adapter.device_name,
                width,
                height,
                hz,
                current.x,
                current.y,
            )
            .map_err(|e| internal(format!("could not switch to {width}x{height}: {e}")))?;
        }
    } else {
        let others: Vec<(i32, i32, u32, u32)> = win32::adapters()
            .iter()
            .filter(|a| a.attached && a.device_name != adapter.device_name)
            .filter_map(|a| win32::current_mode(&a.device_name))
            .map(|m| (m.x, m.y, m.width, m.height))
            .collect();
        let (x, y) = plan::place_right_of(&others);
        win32::attach_persistent(&adapter.device_name, width, height, hz, x, y)
            .map_err(|e| internal(format!("could not attach the virtual display: {e}")))?;
    }

    // 4. Report what Windows really did.
    let now = wait_for(APPLY_TIMEOUT, || {
        win32::current_mode(&adapter.device_name).filter(|m| (m.width, m.height) == (width, height))
    })
    .ok_or_else(|| {
        internal(format!(
            "Windows did not switch the display to {width}x{height}"
        ))
    })?;
    Ok(to_info(&adapter, now))
}

/// Takes the virtual display off the desktop. A display that is already off is not an error.
pub fn detach() -> Result<(), HelperError> {
    let Some(adapter) = find_virtual() else {
        return Ok(());
    };
    let Some(current) = win32::current_mode(&adapter.device_name) else {
        return Ok(());
    };
    win32::detach_persistent(&adapter.device_name, current.x, current.y)
        .map_err(|e| internal(format!("could not detach the virtual display: {e}")))?;
    wait_for(APPLY_TIMEOUT, || {
        win32::current_mode(&adapter.device_name)
            .is_none()
            .then_some(())
    })
    .ok_or_else(|| internal("Windows did not take the virtual display off the desktop"))
}
