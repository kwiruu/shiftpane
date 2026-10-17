//! The Windows implementation behind [`crate::VddBackend`]: list, attach and detach against
//! the real machine, built from the safe wrappers in [`crate::win32`] and the one elevated
//! step in [`crate::elevated`].

use std::fs;
use std::thread::sleep;
use std::time::{Duration, Instant};

use shiftpane_core::Mode;
use shiftpane_core::protocol::{
    DisplayInfo, ErrorCode, HelperError, MediaAction, MediaState, SystemStats,
};

use crate::win32::{self, Adapter, CurrentMode};
use crate::{DEFAULT_SETTINGS_PATH, elevated, media, plan, settings, stats};

/// The performance counter query, opened the first time stats are asked for.
#[derive(Debug, Default)]
pub struct Stats {
    sampler: Option<stats::Sampler>,
    opened: bool,
}

// Reading stats cannot fail as a whole (missing parts are null), but the signature matches the
// stand-in used on other OSes.
#[allow(clippy::unnecessary_wraps)]
pub fn system_stats(state: &mut Stats) -> Result<SystemStats, HelperError> {
    if !state.opened {
        state.opened = true;
        state.sampler = stats::Sampler::new();
    }
    Ok(match state.sampler.as_mut() {
        Some(sampler) => sampler.sample(),
        None => stats::memory_only(),
    })
}

pub fn media_state() -> Result<MediaState, HelperError> {
    media::state().map_err(|e| internal(format!("could not read the media controls: {e}")))
}

pub fn media_control(action: MediaAction) -> Result<(), HelperError> {
    match media::control(action) {
        Ok(true) => Ok(()),
        Ok(false) => Err(internal(
            "nothing is playing, or the app that is playing ignored the button",
        )),
        Err(e) => Err(internal(format!("could not press the media button: {e}"))),
    }
}

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

/// The driver's own display output. Looked up on every call because its device name changes
/// whenever the driver restarts. Matched on the output's adapter, never on the monitor: when
/// Windows duplicates displays, the virtual monitor is listed under the laptop's output too.
fn find_virtual() -> Option<Adapter> {
    win32::adapters()
        .into_iter()
        .find(|a| plan::is_virtual_display(&a.description, &a.device_id))
}

/// Takes the virtual monitor out of "Duplicate these displays", which Windows can choose on
/// its own (for example a laptop with no other screen plugged in), so it extends the desktop.
fn stop_duplicating() -> Result<(), HelperError> {
    if !win32::virtual_monitor_cloned() {
        return Ok(());
    }
    tracing::info!("the virtual monitor is duplicating another display; switching to extend");
    win32::extend_desktop().map_err(|e| {
        internal(format!(
            "could not switch Windows from duplicate to extend: {e}"
        ))
    })?;
    wait_for(APPLY_TIMEOUT, || {
        (!win32::virtual_monitor_cloned()).then_some(())
    })
    .ok_or_else(|| {
        internal(
            "Windows kept the virtual monitor duplicating another display; press Windows+P and choose Extend",
        )
    })
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
        virtual_display: plan::is_virtual_display(&adapter.description, &adapter.device_id),
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

/// The sizes in `wanted` the driver's current mode list does not contain.
fn missing_from(adapter: &Adapter, wanted: &[(u32, u32)]) -> Vec<(u32, u32)> {
    plan::missing_sizes(&win32::supported_modes(&adapter.device_name), wanted)
}

/// Makes sure the driver offers every size in `wanted`. All the missing ones are added by one
/// elevated step, so this costs at most one UAC prompt however many sizes are listed. Returns
/// how many were added.
fn ensure_sizes(wanted: &[(u32, u32)]) -> Result<u32, HelperError> {
    let adapter = find_virtual().ok_or_else(driver_missing)?;
    let missing = missing_from(&adapter, wanted);
    if missing.is_empty() {
        return Ok(0);
    }

    // The driver loses its monitor when its list is too long, so refuse before asking for
    // administrator approval rather than after.
    let listed = fs::read_to_string(DEFAULT_SETTINGS_PATH)
        .map(|xml| settings::listed_resolutions(&xml))
        .unwrap_or_default();
    if plan::list_len_after(&listed, &missing) > plan::MAX_LISTED_RESOLUTIONS {
        return Err(HelperError::invalid_params(format!(
            "the driver's size list holds at most {} sizes and already has {}",
            plan::MAX_LISTED_RESOLUTIONS,
            listed.len()
        )));
    }
    // Sizes already in the driver's file that Windows still does not offer will not appear
    // after a restart either, so asking for approval again would only repeat the prompt.
    if missing.iter().all(|size| listed.contains(size)) {
        let list: Vec<String> = missing.iter().map(|(w, h)| format!("{w}x{h}")).collect();
        return Err(internal(format!(
            "the driver lists {} but Windows does not offer it for the virtual monitor; \
             restarting the PC usually fixes this",
            list.join(", ")
        )));
    }

    elevated::add_modes(&missing)?;
    wait_for(RELOAD_TIMEOUT, || {
        find_virtual().filter(|a| missing_from(a, &missing).is_empty())
    })
    .ok_or_else(|| {
        if find_virtual().is_none() {
            return internal("the virtual monitor did not come back after the driver restarted");
        }
        let list: Vec<String> = missing.iter().map(|(w, h)| format!("{w}x{h}")).collect();
        internal(format!(
            "the driver was restarted but still does not offer {}",
            list.join(", ")
        ))
    })?;
    Ok(u32::try_from(missing.len()).unwrap_or(u32::MAX))
}

/// Adds every size the driver does not list yet, without creating or moving the monitor.
pub fn prepare(sizes: &[(u32, u32)]) -> Result<u32, HelperError> {
    ensure_sizes(sizes)
}

pub fn attach(mode: Mode) -> Result<DisplayInfo, HelperError> {
    if mode.scale_percent.is_some() {
        return Err(HelperError::unsupported(
            "per-monitor scaling is not implemented on Windows yet",
        ));
    }
    let (width, height) = (mode.width, mode.height);

    // 0. A virtual monitor Windows is using as a copy of another display cannot extend it.
    stop_duplicating()?;

    // 1. Make sure the driver offers this size; adding it is the only step that needs UAC.
    //    `display.prepare` normally did this already, so this is a no-op in the common case.
    ensure_sizes(&[(width, height)])?;

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
