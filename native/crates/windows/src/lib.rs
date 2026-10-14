//! Windows backend.
//!
//! Windows has no API for an app to create a monitor, so this backend drives
//! [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver), an
//! IddCx driver the user installs once (`winget install --id=VirtualDrivers.Virtual-Display-Driver -e`).
//! We configure it; we never bundle or modify it.
//!
//! Attach, once implemented, is:
//! 1. write the requested mode into the resolution list in `vdd_settings.xml`;
//! 2. reload the driver so it re-reads the list (device restart through SetupAPI;
//!    `pnputil /restart-device` as the fallback);
//! 3. switch the new monitor to the mode with `ChangeDisplaySettingsExW` and set its
//!    DPI scaling, then report its device name so the desktop app can match Electron's
//!    `display_id` and capture only that screen.
//!
//! Detach disables the virtual adapter (the driver's monitor count cannot be zero), and
//! Windows moves the windows on it back to the remaining screens.
//!
//! The settings file lives under `C:\`, so writing it needs elevation: the desktop app runs
//! that one step through a UAC prompt, and everything else runs unelevated.

use std::path::{Path, PathBuf};

use shiftpane_core::protocol::{BackendInfo, Capabilities, DisplayInfo, HelperError};
use shiftpane_core::{DisplayBackend, Mode};

pub const DEFAULT_SETTINGS_PATH: &str = r"C:\VirtualDisplayDriver\vdd_settings.xml";
pub const INSTALL_HINT: &str =
    "Install Virtual Display Driver: winget install --id=VirtualDrivers.Virtual-Display-Driver -e";

#[derive(Debug)]
pub struct VddBackend {
    settings_path: PathBuf,
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
}

impl DisplayBackend for VddBackend {
    fn info(&self) -> BackendInfo {
        let reason = self.not_ready_reason();
        BackendInfo {
            name: "vdd".into(),
            ready: reason.is_none(),
            reason,
            // What this backend will offer once attach is implemented.
            capabilities: Capabilities {
                virtual_display: true,
                resize: true,
                scaling: true,
                input_injection: true,
                window_control: true,
            },
        }
    }

    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError> {
        Err(HelperError::unsupported(
            "display.list is not implemented on Windows yet",
        ))
    }

    fn attach(&mut self, _mode: Mode) -> Result<DisplayInfo, HelperError> {
        if let Some(reason) = self.not_ready_reason() {
            return Err(HelperError::new(
                shiftpane_core::protocol::ErrorCode::BackendUnavailable,
                reason,
            ));
        }
        Err(HelperError::unsupported(
            "display.attach is not implemented on Windows yet",
        ))
    }

    fn detach(&mut self) -> Result<(), HelperError> {
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
}
