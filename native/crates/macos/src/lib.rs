//! macOS backend.
//!
//! macOS can create a virtual monitor in-process with the `CGVirtualDisplay` family of
//! CoreGraphics classes (macOS 11+), the same mechanism DeskPad and BetterDisplay use, so no
//! driver or admin rights are needed. The classes are not in the public SDK headers; they
//! are declared here with `objc2`.
//!
//! Attach, once implemented, builds a `CGVirtualDisplayDescriptor` (size in millimetres,
//! max pixels, vendor/product ids), creates the `CGVirtualDisplay`, then applies a
//! `CGVirtualDisplaySettings` with one `CGVirtualDisplayMode` at the requested size
//! (`hiDPI = 1` for 2x scaling). Resizing applies new settings to the same display.
//! The display lives exactly as long as the object, which is why the helper is a
//! long-running process: detach, or the helper exiting, removes the monitor.
//!
//! Capturing that monitor needs the Screen Recording permission, granted to the desktop app.

use shiftpane_core::protocol::{BackendInfo, Capabilities, DisplayInfo, ErrorCode, HelperError};
use shiftpane_core::{DisplayBackend, Mode};

#[derive(Debug, Default)]
pub struct VirtualDisplayBackend;

impl VirtualDisplayBackend {
    /// Whether this macOS build exposes `CGVirtualDisplay`.
    #[cfg(target_os = "macos")]
    fn api_available() -> bool {
        objc2::runtime::AnyClass::get(c"CGVirtualDisplay").is_some()
    }

    #[cfg(not(target_os = "macos"))]
    fn api_available() -> bool {
        false
    }
}

impl DisplayBackend for VirtualDisplayBackend {
    fn info(&self) -> BackendInfo {
        let ready = Self::api_available();
        BackendInfo {
            name: "cg-virtual-display".into(),
            ready,
            reason: (!ready).then(|| {
                "CGVirtualDisplay is unavailable; macOS 11 or later is required".to_owned()
            }),
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
            "display.list is not implemented on macOS yet",
        ))
    }

    fn attach(&mut self, _mode: Mode) -> Result<DisplayInfo, HelperError> {
        if !Self::api_available() {
            return Err(HelperError::new(
                ErrorCode::BackendUnavailable,
                "CGVirtualDisplay is unavailable",
            ));
        }
        Err(HelperError::unsupported(
            "display.attach is not implemented on macOS yet",
        ))
    }

    fn detach(&mut self) -> Result<(), HelperError> {
        Ok(())
    }
}
