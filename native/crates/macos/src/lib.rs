//! macOS backend.
//!
//! macOS can create a virtual monitor in-process with the `CGVirtualDisplay` family of
//! CoreGraphics classes (macOS 11+), the same mechanism DeskPad and BetterDisplay use, so no
//! driver or admin rights are needed. The classes are not in the public SDK headers; they
//! are reached through the Objective-C runtime with `objc2` (see `cg.rs`).
//!
//! Attach builds a `CGVirtualDisplayDescriptor` (size in millimetres, max pixels, vendor/product
//! ids), creates the `CGVirtualDisplay`, then applies a `CGVirtualDisplaySettings` with one
//! `CGVirtualDisplayMode` at the requested size (`hiDPI = 1` for a scale of 200% or more).
//! Resizing within the size it was made for applies new settings to the same display; anything
//! bigger makes it again. The display lives exactly as long as the object, which is why the
//! helper is a long-running process: detach, or the helper exiting, removes the monitor.
//!
//! Capturing that monitor needs the Screen Recording permission, granted to the desktop app.
//!
//! This backend is compiled and linted for macOS from Windows; it has not been run on a Mac yet.

#[cfg(target_os = "macos")]
mod cg;

use shiftpane_core::protocol::{BackendInfo, Capabilities, DisplayInfo, ErrorCode, HelperError};
use shiftpane_core::{DisplayBackend, Mode};

#[derive(Debug, Default)]
pub struct VirtualDisplayBackend {
    #[cfg(target_os = "macos")]
    display: Option<cg::VirtualDisplay>,
}

impl VirtualDisplayBackend {
    /// Whether this macOS build exposes `CGVirtualDisplay`.
    #[cfg(target_os = "macos")]
    fn api_available() -> bool {
        cg::available()
    }

    #[cfg(not(target_os = "macos"))]
    fn api_available() -> bool {
        false
    }
}

fn unavailable() -> HelperError {
    HelperError::new(
        ErrorCode::BackendUnavailable,
        "CGVirtualDisplay is unavailable",
    )
}

/// `HiDPI` draws every point as two pixels, which is macOS' only scale for a virtual display.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn hidpi(mode: &Mode) -> bool {
    mode.scale_percent.is_some_and(|percent| percent >= 200)
}

#[cfg(target_os = "macos")]
fn to_info(shown: cg::Shown, virtual_id: Option<u32>) -> DisplayInfo {
    let virtual_display = Some(shown.id) == virtual_id;
    DisplayInfo {
        id: shown.id.to_string(),
        name: if virtual_display {
            "ShiftPane".to_owned()
        } else {
            format!("Display {}", shown.id)
        },
        x: shown.x,
        y: shown.y,
        width: shown.width,
        height: shown.height,
        refresh_hz: shown.refresh_hz,
        scale_factor: shown.scale_factor,
        primary: shown.primary,
        virtual_display,
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

    #[cfg(target_os = "macos")]
    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError> {
        let virtual_id = self.display.as_ref().map(|display| display.id);
        Ok(cg::displays()
            .into_iter()
            .map(|shown| to_info(shown, virtual_id))
            .collect())
    }

    #[cfg(not(target_os = "macos"))]
    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError> {
        Err(unavailable())
    }

    #[cfg(target_os = "macos")]
    fn attach(&mut self, mode: Mode) -> Result<DisplayInfo, HelperError> {
        if !Self::api_available() {
            return Err(unavailable());
        }
        let (width, height, hz, scaled) = (mode.width, mode.height, mode.refresh_hz, hidpi(&mode));
        let failed = |message: String| HelperError::new(ErrorCode::Internal, message);
        let shown = match &self.display {
            Some(display) if display.fits(width, height) => {
                display.apply(width, height, hz, scaled).map_err(failed)?
            }
            _ => {
                // Bigger than the display was made for: make it again. The old one goes first,
                // so macOS never shows two.
                self.display = None;
                let display =
                    cg::VirtualDisplay::create(width, height, hz, scaled).map_err(failed)?;
                let shown = cg::shown(display.id)
                    .ok_or_else(|| failed("macOS did not show the virtual display".to_owned()))?;
                self.display = Some(display);
                shown
            }
        };
        let virtual_id = self.display.as_ref().map(|display| display.id);
        Ok(to_info(shown, virtual_id))
    }

    #[cfg(not(target_os = "macos"))]
    fn attach(&mut self, _mode: Mode) -> Result<DisplayInfo, HelperError> {
        Err(unavailable())
    }

    fn detach(&mut self) -> Result<(), HelperError> {
        // Dropping the display is what removes it.
        #[cfg(target_os = "macos")]
        {
            self.display = None;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_hidpi_from_a_scale_of_two() {
        let mode = |scale_percent| Mode {
            width: 2400,
            height: 1080,
            refresh_hz: 60,
            scale_percent,
        };
        assert!(!hidpi(&mode(None)));
        assert!(!hidpi(&mode(Some(150))));
        assert!(hidpi(&mode(Some(200))));
        assert!(hidpi(&mode(Some(300))));
    }
}
