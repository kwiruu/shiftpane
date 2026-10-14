//! Linux backend.
//!
//! There is no single Linux API for a virtual monitor; each compositor has its own, so the
//! backend picks a strategy from the session:
//!
//! | Session | Strategy |
//! | --- | --- |
//! | GNOME (Wayland) | Mutter `org.gnome.Mutter.ScreenCast` `RecordVirtual`: a virtual monitor plus a PipeWire stream of it, alive while the D-Bus session is held |
//! | KDE Plasma (Wayland) | KWin virtual output through the `zkde_screencast_unstable_v1` `stream_virtual_output` request |
//! | wlroots (Sway, Hyprland) | Headless output: `swaymsg create_output` / `hyprctl output create headless`, then set its mode |
//! | X11 | `xrandr --setmonitor` on a spare or dummy output |
//!
//! Detection is implemented; attach is not yet.

use shiftpane_core::protocol::{BackendInfo, Capabilities, DisplayInfo, ErrorCode, HelperError};
use shiftpane_core::{DisplayBackend, Mode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strategy {
    Mutter,
    KWin,
    Wlroots,
    X11,
}

impl Strategy {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Mutter => "mutter",
            Self::KWin => "kwin",
            Self::Wlroots => "wlroots",
            Self::X11 => "x11",
        }
    }

    /// Picks a strategy from `XDG_SESSION_TYPE` and `XDG_CURRENT_DESKTOP`.
    pub fn detect(session_type: Option<&str>, current_desktop: Option<&str>) -> Option<Self> {
        let desktop = current_desktop.unwrap_or_default().to_ascii_lowercase();
        match session_type.map(str::to_ascii_lowercase).as_deref() {
            Some("x11") => Some(Self::X11),
            Some("wayland") => {
                if desktop.contains("gnome") {
                    Some(Self::Mutter)
                } else if desktop.contains("kde") {
                    Some(Self::KWin)
                } else if ["sway", "hyprland", "river", "wlroots"]
                    .iter()
                    .any(|d| desktop.contains(d))
                {
                    Some(Self::Wlroots)
                } else {
                    None
                }
            }
            _ => None,
        }
    }
}

#[derive(Debug)]
pub struct CompositorBackend {
    strategy: Option<Strategy>,
}

impl CompositorBackend {
    pub fn from_env() -> Self {
        let session = std::env::var("XDG_SESSION_TYPE").ok();
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").ok();
        Self {
            strategy: Strategy::detect(session.as_deref(), desktop.as_deref()),
        }
    }

    pub fn strategy(&self) -> Option<Strategy> {
        self.strategy
    }
}

impl DisplayBackend for CompositorBackend {
    fn info(&self) -> BackendInfo {
        match self.strategy {
            Some(strategy) => BackendInfo {
                name: strategy.name().into(),
                ready: false,
                reason: Some(format!(
                    "the {} backend is not implemented yet",
                    strategy.name()
                )),
                capabilities: Capabilities {
                    virtual_display: true,
                    resize: true,
                    ..Capabilities::default()
                },
            },
            None => BackendInfo {
                name: "unknown".into(),
                ready: false,
                reason: Some(
                    "unrecognised desktop session; set XDG_SESSION_TYPE and XDG_CURRENT_DESKTOP"
                        .into(),
                ),
                capabilities: Capabilities::default(),
            },
        }
    }

    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError> {
        Err(HelperError::unsupported(
            "display.list is not implemented on Linux yet",
        ))
    }

    fn attach(&mut self, _mode: Mode) -> Result<DisplayInfo, HelperError> {
        match self.strategy {
            Some(strategy) => Err(HelperError::unsupported(format!(
                "{} attach is not implemented yet",
                strategy.name()
            ))),
            None => Err(HelperError::new(
                ErrorCode::BackendUnavailable,
                "unrecognised desktop session",
            )),
        }
    }

    fn detach(&mut self) -> Result<(), HelperError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_sessions() {
        assert_eq!(
            Strategy::detect(Some("wayland"), Some("ubuntu:GNOME")),
            Some(Strategy::Mutter)
        );
        assert_eq!(
            Strategy::detect(Some("wayland"), Some("KDE")),
            Some(Strategy::KWin)
        );
        assert_eq!(
            Strategy::detect(Some("wayland"), Some("sway")),
            Some(Strategy::Wlroots)
        );
        assert_eq!(
            Strategy::detect(Some("wayland"), Some("Hyprland")),
            Some(Strategy::Wlroots)
        );
        assert_eq!(
            Strategy::detect(Some("x11"), Some("XFCE")),
            Some(Strategy::X11)
        );
        assert_eq!(Strategy::detect(Some("tty"), None), None);
        assert_eq!(Strategy::detect(Some("wayland"), Some("weird-wm")), None);
    }
}
