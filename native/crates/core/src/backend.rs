//! The contract each OS crate implements.

use crate::mode::Mode;
use crate::protocol::{BackendInfo, Capabilities, DisplayInfo, HelperError};

/// One virtual-monitor strategy for one OS.
///
/// The helper holds a single backend for its whole life. On macOS and on GNOME/KDE the
/// virtual monitor only exists while the process that created it is alive, so the helper
/// is a long-running process rather than a one-shot command.
pub trait DisplayBackend {
    /// Cheap, side-effect-free readiness check, called for `helper.hello`.
    fn info(&self) -> BackendInfo;

    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError>;

    /// Creates the virtual monitor at `mode`, or resizes the existing one.
    fn attach(&mut self, mode: Mode) -> Result<DisplayInfo, HelperError>;

    /// Removes the virtual monitor. Must be safe to call when none exists.
    fn detach(&mut self) -> Result<(), HelperError>;
}

/// Backend for targets with no implementation, so the helper still starts and reports why.
#[derive(Debug, Default)]
pub struct UnsupportedBackend {
    reason: String,
}

impl UnsupportedBackend {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

impl DisplayBackend for UnsupportedBackend {
    fn info(&self) -> BackendInfo {
        BackendInfo {
            name: "unsupported".into(),
            ready: false,
            reason: Some(self.reason.clone()),
            capabilities: Capabilities::default(),
        }
    }

    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError> {
        Err(HelperError::unsupported(self.reason.clone()))
    }

    fn attach(&mut self, _mode: Mode) -> Result<DisplayInfo, HelperError> {
        Err(HelperError::unsupported(self.reason.clone()))
    }

    fn detach(&mut self) -> Result<(), HelperError> {
        Ok(())
    }
}
