//! The contract each OS crate implements.

use crate::mode::Mode;
use crate::protocol::{
    BackendInfo, Capabilities, DisplayInfo, HelperError, MediaAction, MediaState, SystemStats,
};

/// One virtual-monitor strategy for one OS.
///
/// The helper holds a single backend for its whole life. On macOS and on GNOME/KDE the
/// virtual monitor only exists while the process that created it is alive, so the helper
/// is a long-running process rather than a one-shot command.
pub trait DisplayBackend {
    /// Cheap, side-effect-free readiness check, called for `helper.hello`.
    fn info(&self) -> BackendInfo;

    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError>;

    /// Makes sure every `(width, height)` in `sizes` can be switched to without further
    /// approval from the user, and returns how many had to be added (0 = nothing was asked).
    ///
    /// The sizes are already validated and unique. Backends that can create any size on demand
    /// have nothing to do, which is what the default says; Windows adds sizes to the driver's
    /// list behind a single UAC prompt.
    fn prepare(&mut self, sizes: &[(u32, u32)]) -> Result<u32, HelperError> {
        let _ = sizes;
        Ok(0)
    }

    /// Creates the virtual monitor at `mode`, or resizes the existing one.
    fn attach(&mut self, mode: Mode) -> Result<DisplayInfo, HelperError>;

    /// Removes the virtual monitor. Must be safe to call when none exists.
    fn detach(&mut self) -> Result<(), HelperError>;

    /// Load of the PC for the stats widget. These three are not about displays, but the helper
    /// is the one native process the desktop app runs, so they live on the same backend; an OS
    /// without them keeps these defaults.
    fn system_stats(&mut self) -> Result<SystemStats, HelperError> {
        Err(HelperError::unsupported(
            "system stats are not available on this OS yet",
        ))
    }

    fn media_state(&mut self) -> Result<MediaState, HelperError> {
        Err(HelperError::unsupported(
            "media controls are not available on this OS yet",
        ))
    }

    fn media_control(&mut self, action: MediaAction) -> Result<(), HelperError> {
        let _ = action;
        Err(HelperError::unsupported(
            "media controls are not available on this OS yet",
        ))
    }
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

    fn prepare(&mut self, _sizes: &[(u32, u32)]) -> Result<u32, HelperError> {
        Err(HelperError::unsupported(self.reason.clone()))
    }

    fn attach(&mut self, _mode: Mode) -> Result<DisplayInfo, HelperError> {
        Err(HelperError::unsupported(self.reason.clone()))
    }

    fn detach(&mut self) -> Result<(), HelperError> {
        Ok(())
    }
}
