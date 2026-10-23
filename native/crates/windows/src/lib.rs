//! Windows backend.
//!
//! Windows has no API for an app to create a monitor, so this backend drives
//! [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver), an
//! IddCx driver the user installs once. We configure it; we never modify it.
//!
//! How the pieces fit:
//! - The driver offers a fixed list of resolutions read from `vdd_settings.xml`. Switching to
//!   a size on that list is an ordinary `ChangeDisplaySettingsExW` call and needs no rights.
//! - Adding sizes means editing the file (under `C:\`) and restarting the driver, which does
//!   need administrator rights. The helper does that by starting a copy of itself elevated
//!   with a fixed numbers-only sub-command ([`elevated`]); one prompt adds every size missing
//!   from the call, and a size is never asked for again once the driver lists it.
//!   `display.prepare` takes all the sizes a phone can need up front, so a phone costs at most
//!   one prompt; `display.attach` adds a lone missing size the same way as a fallback.
//! - Attach finds the driver's display (by adapter, never by `\\.\DISPLAYn`, which changes on
//!   every driver restart), makes sure the size exists, then switches mode or puts the display
//!   back on the desktop to the right of the others.
//! - Detach takes the display off the desktop without elevation, and Windows moves its windows
//!   back to the remaining screens. The helper only detaches a display it attached itself, so
//!   closing ShiftPane never removes a monitor the user set up by hand.
//!
//! Everything that decides something ([`settings`], [`plan`]) is plain Rust tested on every OS;
//! the Win32 calls sit behind `cfg(windows)`.

use std::path::{Path, PathBuf};

use shiftpane_core::protocol::{
    ActiveWindow, AudioControlParams, AudioState, BackendInfo, Battery, Capabilities, DisplayInfo,
    DriveInfo, ErrorCode, HelperError, MediaAction, MediaState, ProcessLoad, SystemStats,
};
use shiftpane_core::{DisplayBackend, Mode};

pub mod plan;
pub mod settings;

#[cfg(windows)]
mod audio;
#[cfg(windows)]
mod counters;
#[cfg(windows)]
mod disks;
#[cfg(windows)]
pub mod elevated;
#[cfg(windows)]
mod foreground;
#[cfg(windows)]
mod live;
#[cfg(windows)]
mod media;
#[cfg(windows)]
mod power;
#[cfg(windows)]
mod processes;
#[cfg(windows)]
mod stats;
#[cfg(windows)]
mod thermals;
#[cfg(windows)]
mod win32;

/// Stand-ins so the crate still compiles on other OSes; the helper only builds this backend
/// on Windows.
#[cfg(not(windows))]
mod live {
    use super::{
        ActiveWindow, AudioControlParams, AudioState, Battery, DisplayInfo, DriveInfo, HelperError,
        MediaAction, MediaState, Mode, ProcessLoad, SystemStats,
    };

    fn unsupported() -> HelperError {
        HelperError::unsupported("the Windows backend only runs on Windows")
    }

    #[derive(Debug, Default)]
    pub struct Stats;

    pub fn system_stats(_state: &mut Stats) -> Result<SystemStats, HelperError> {
        Err(unsupported())
    }

    pub fn media_state() -> Result<MediaState, HelperError> {
        Err(unsupported())
    }

    pub fn media_control(_action: MediaAction) -> Result<(), HelperError> {
        Err(unsupported())
    }

    pub fn disks(_state: &mut Stats) -> Result<Vec<DriveInfo>, HelperError> {
        Err(unsupported())
    }

    pub fn processes(_state: &mut Stats) -> Result<Vec<ProcessLoad>, HelperError> {
        Err(unsupported())
    }

    pub fn power() -> Result<Option<Battery>, HelperError> {
        Err(unsupported())
    }

    pub fn audio_state() -> Result<AudioState, HelperError> {
        Err(unsupported())
    }

    pub fn audio_control(_params: AudioControlParams) -> Result<(), HelperError> {
        Err(unsupported())
    }

    pub fn active_window() -> Result<ActiveWindow, HelperError> {
        Err(unsupported())
    }

    pub fn list_displays() -> Result<Vec<DisplayInfo>, HelperError> {
        Err(unsupported())
    }

    pub fn prepare(_sizes: &[(u32, u32)]) -> Result<u32, HelperError> {
        Err(unsupported())
    }

    pub fn attach(_mode: Mode) -> Result<DisplayInfo, HelperError> {
        Err(unsupported())
    }

    // Same signature as the Windows implementation, which can fail.
    #[allow(clippy::unnecessary_wraps)]
    pub fn detach() -> Result<(), HelperError> {
        Ok(())
    }
}

pub const DEFAULT_SETTINGS_PATH: &str = r"C:\VirtualDisplayDriver\vdd_settings.xml";
pub const INSTALL_HINT: &str = "Install Virtual Display Driver: run \
    `winget install --id=VirtualDrivers.Virtual-Display-Driver -e`, then open VDD Control from \
    the winget package folder and click Install";

#[derive(Debug)]
pub struct VddBackend {
    settings_path: PathBuf,
    /// Whether this process put the virtual display on the desktop (or resized it).
    attached: bool,
    /// The performance counter queries behind `system.stats`, `disks.state` and
    /// `processes.top`, each opened on first use.
    stats: live::Stats,
}

impl Default for VddBackend {
    fn default() -> Self {
        Self::new(DEFAULT_SETTINGS_PATH)
    }
}

impl VddBackend {
    // `live::Stats` holds the counter query on Windows but is a unit struct on other OSes.
    #[allow(clippy::default_constructed_unit_structs)]
    pub fn new(settings_path: impl Into<PathBuf>) -> Self {
        Self {
            settings_path: settings_path.into(),
            attached: false,
            stats: live::Stats::default(),
        }
    }

    pub fn settings_path(&self) -> &Path {
        &self.settings_path
    }

    fn not_ready_reason(&self) -> Option<String> {
        if self.settings_path.is_file() {
            None
        } else {
            Some(format!(
                "{} not found. {INSTALL_HINT}",
                self.settings_path.display()
            ))
        }
    }

    fn require_ready(&self) -> Result<(), HelperError> {
        match self.not_ready_reason() {
            Some(reason) => Err(HelperError::new(ErrorCode::BackendUnavailable, reason)),
            None => Ok(()),
        }
    }
}

impl DisplayBackend for VddBackend {
    fn info(&self) -> BackendInfo {
        let reason = self.not_ready_reason();
        BackendInfo {
            name: "vdd".into(),
            ready: reason.is_none(),
            reason,
            capabilities: Capabilities {
                virtual_display: true,
                resize: true,
                // Per-monitor scaling, through the requests Windows' own Settings makes.
                scaling: true,
                input_injection: true,
                window_control: true,
            },
        }
    }

    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError> {
        live::list_displays()
    }

    fn prepare(&mut self, sizes: &[(u32, u32)]) -> Result<u32, HelperError> {
        self.require_ready()?;
        live::prepare(sizes)
    }

    fn attach(&mut self, mode: Mode) -> Result<DisplayInfo, HelperError> {
        self.require_ready()?;
        let display = live::attach(mode)?;
        self.attached = true;
        Ok(display)
    }

    fn detach(&mut self) -> Result<(), HelperError> {
        if !self.attached {
            return Ok(());
        }
        live::detach()?;
        self.attached = false;
        Ok(())
    }

    // Stats and media controls do not need the display driver, so they are not gated on it.

    fn system_stats(&mut self) -> Result<SystemStats, HelperError> {
        live::system_stats(&mut self.stats)
    }

    fn media_state(&mut self) -> Result<MediaState, HelperError> {
        live::media_state()
    }

    fn media_control(&mut self, action: MediaAction) -> Result<(), HelperError> {
        live::media_control(action)
    }

    fn disks(&mut self) -> Result<Vec<DriveInfo>, HelperError> {
        live::disks(&mut self.stats)
    }

    fn processes(&mut self) -> Result<Vec<ProcessLoad>, HelperError> {
        live::processes(&mut self.stats)
    }

    fn power(&mut self) -> Result<Option<Battery>, HelperError> {
        live::power()
    }

    fn audio_state(&mut self) -> Result<AudioState, HelperError> {
        live::audio_state()
    }

    fn audio_control(&mut self, params: AudioControlParams) -> Result<(), HelperError> {
        live::audio_control(params)
    }

    fn active_window(&mut self) -> Result<ActiveWindow, HelperError> {
        live::active_window()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_driver_is_reported_with_install_hint() {
        let backend = VddBackend::new("/definitely/not/here/vdd_settings.xml");
        let info = backend.info();
        assert!(!info.ready);
        assert!(info.reason.unwrap().contains("winget install"));
    }

    #[test]
    fn attach_without_the_driver_is_backend_unavailable() {
        let mut backend = VddBackend::new("/definitely/not/here/vdd_settings.xml");
        let mode = Mode {
            width: 1440,
            height: 1080,
            refresh_hz: 60,
            scale_percent: None,
        };
        let err = backend.attach(mode).unwrap_err();
        assert_eq!(err.code, ErrorCode::BackendUnavailable);
    }

    #[test]
    fn prepare_without_the_driver_is_backend_unavailable() {
        let mut backend = VddBackend::new("/definitely/not/here/vdd_settings.xml");
        let err = backend.prepare(&[(1440, 1080), (1080, 1440)]).unwrap_err();
        assert_eq!(err.code, ErrorCode::BackendUnavailable);
        assert!(err.message.contains("winget install"));
    }

    #[test]
    fn detach_is_a_no_op_when_this_process_attached_nothing() {
        let mut backend = VddBackend::new("/definitely/not/here/vdd_settings.xml");
        assert!(backend.detach().is_ok());
    }
}
