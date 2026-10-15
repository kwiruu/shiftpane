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

use shiftpane_core::protocol::{BackendInfo, Capabilities, DisplayInfo, ErrorCode, HelperError};
use shiftpane_core::{DisplayBackend, Mode};

pub mod plan;
pub mod settings;

#[cfg(windows)]
pub mod elevated;
#[cfg(windows)]
mod live;
#[cfg(windows)]
mod win32;

/// Stand-ins so the crate still compiles on other OSes; the helper only builds this backend
/// on Windows.
#[cfg(not(windows))]
mod live {
    use super::{DisplayInfo, HelperError, Mode};

    fn unsupported() -> HelperError {
        HelperError::unsupported("the Windows backend only runs on Windows")
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
}

impl Default for VddBackend {
    fn default() -> Self {
        Self::new(DEFAULT_SETTINGS_PATH)
    }
}

impl VddBackend {
    pub fn new(settings_path: impl Into<PathBuf>) -> Self {
        Self {
            settings_path: settings_path.into(),
            attached: false,
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
                // Per-monitor DPI scaling has no documented Win32 API; attach rejects it.
                scaling: false,
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
