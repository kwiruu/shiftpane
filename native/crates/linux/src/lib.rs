//! Linux backend.
//!
//! There is no single Linux API for a virtual monitor; each compositor has its own, so the
//! backend picks a strategy from the session:
//!
//! | Session | Strategy |
//! | --- | --- |
//! | Sway, Hyprland (Wayland) | A headless output: `swaymsg create_output` / `hyprctl output create headless`, then its mode, position and scale (`wlroots.rs`) |
//! | X11 | `xrandr --newmode` on a spare `VIRTUAL` output or free connector (`x11.rs`) |
//! | GNOME (Wayland) | Mutter `org.gnome.Mutter.ScreenCast` `RecordVirtual`: a virtual monitor plus a PipeWire stream of it. Not done yet |
//! | KDE Plasma (Wayland) | KWin's `zkde_screencast_unstable_v1` `stream_virtual_output`. Not done yet |
//!
//! The commands run as the user, in their session; nothing here needs root. This backend is
//! compiled, linted and unit-tested on Windows; it has not been run on a Linux desktop yet.

mod wlroots;
mod x11;

use std::process::Command;

use shiftpane_core::protocol::{BackendInfo, Capabilities, DisplayInfo, ErrorCode, HelperError};
use shiftpane_core::{DisplayBackend, Mode};
use wlroots::Compositor;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strategy {
    Mutter,
    KWin,
    Sway,
    Hyprland,
    X11,
}

impl Strategy {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Mutter => "mutter",
            Self::KWin => "kwin",
            Self::Sway => "sway",
            Self::Hyprland => "hyprland",
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
                } else if desktop.contains("sway") {
                    Some(Self::Sway)
                } else if desktop.contains("hyprland") {
                    Some(Self::Hyprland)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    const fn compositor(self) -> Option<Compositor> {
        match self {
            Self::Sway => Some(Compositor::Sway),
            Self::Hyprland => Some(Compositor::Hyprland),
            _ => None,
        }
    }
}

#[derive(Debug)]
pub struct CompositorBackend {
    strategy: Option<Strategy>,
    /// The output the monitor is on, while it is up.
    output: Option<String>,
    /// X11 only: the mode made for it, to drop when it goes.
    x11_mode: Option<String>,
}

impl CompositorBackend {
    pub fn from_env() -> Self {
        let session = std::env::var("XDG_SESSION_TYPE").ok();
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").ok();
        Self {
            strategy: Strategy::detect(session.as_deref(), desktop.as_deref()),
            output: None,
            x11_mode: None,
        }
    }

    pub fn strategy(&self) -> Option<Strategy> {
        self.strategy
    }

    fn attach_wlroots(
        &mut self,
        compositor: Compositor,
        mode: Mode,
    ) -> Result<DisplayInfo, HelperError> {
        let list = || -> Result<Vec<wlroots::Output>, HelperError> {
            let (program, args) = compositor.list_command();
            Ok(compositor.parse_outputs(&run(program, &args)?))
        };
        let name = if let Some(name) = &self.output {
            name.clone()
        } else {
            let before = list()?;
            let (program, args) = compositor.create_command();
            run(program, &args)?;
            wlroots::new_output(&before, &list()?)
                .ok_or_else(|| internal("the compositor made no new output"))?
        };
        self.output = Some(name.clone());
        let x = wlroots::right_of(&list()?, &name);
        let scale = mode
            .scale_percent
            .map_or(1.0, |percent| f64::from(percent) / 100.0);
        let (program, args) = compositor.configure_command(
            &name,
            (mode.width, mode.height, mode.refresh_hz),
            x,
            scale,
        );
        run(program, &args)?;
        let output = list()?
            .into_iter()
            .find(|output| output.name == name)
            .ok_or_else(|| internal(format!("{name} is not among the outputs")))?;
        Ok(wlroots_info(output, true))
    }

    fn attach_x11(&mut self, mode: Mode) -> Result<DisplayInfo, HelperError> {
        let outputs = x11::parse_outputs(&run("xrandr", &["--query".into()])?);
        let name = match &self.output {
            Some(name) => name.clone(),
            None => x11::pick_spare(&outputs).map(|output| output.name.clone()).ok_or_else(|| {
                HelperError::new(
                    ErrorCode::BackendUnavailable,
                    "X11 has no spare output to put the monitor on; it needs a VIRTUAL output (the Intel driver's VirtualHeads) or a free connector",
                )
            })?,
        };
        let modeline = x11::cvt_reduced(mode.width, mode.height, mode.refresh_hz);
        // Both fail harmlessly when the mode is already there from an earlier attach.
        let mut new_mode = vec!["--newmode".to_owned()];
        new_mode.extend(modeline.args());
        let _ = run("xrandr", &new_mode);
        let _ = run(
            "xrandr",
            &["--addmode".into(), name.clone(), modeline.name.clone()],
        );
        let x = x11::right_of(&outputs, &name);
        run(
            "xrandr",
            &[
                "--output".into(),
                name.clone(),
                "--mode".into(),
                modeline.name.clone(),
                "--pos".into(),
                format!("{x}x0"),
            ],
        )?;
        if let Some(old) = self
            .x11_mode
            .replace(modeline.name.clone())
            .filter(|old| *old != modeline.name)
        {
            drop_x11_mode(&name, &old);
        }
        self.output = Some(name.clone());
        let output = x11::parse_outputs(&run("xrandr", &["--query".into()])?)
            .into_iter()
            .find(|output| output.name == name)
            .ok_or_else(|| internal(format!("{name} is gone")))?;
        x11_info(&output, true).ok_or_else(|| internal(format!("X did not turn {name} on")))
    }
}

/// Runs a command in the user's session and returns what it printed.
fn run(program: &str, args: &[String]) -> Result<String, HelperError> {
    let output = Command::new(program).args(args).output().map_err(|error| {
        HelperError::new(
            ErrorCode::BackendUnavailable,
            format!("{program} could not run: {error}"),
        )
    })?;
    if !output.status.success() {
        let said = String::from_utf8_lossy(&output.stderr);
        return Err(internal(format!(
            "{program} {} failed: {}",
            args.join(" "),
            said.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn internal(message: impl Into<String>) -> HelperError {
    HelperError::new(ErrorCode::Internal, message.into())
}

fn drop_x11_mode(output: &str, mode: &str) {
    // Best effort: a mode still in use stays, which is harmless.
    let _ = run("xrandr", &["--delmode".into(), output.into(), mode.into()]);
    let _ = run("xrandr", &["--rmmode".into(), mode.into()]);
}

fn wlroots_info(output: wlroots::Output, virtual_display: bool) -> DisplayInfo {
    DisplayInfo {
        id: output.name.clone(),
        name: output.name,
        x: output.x,
        y: output.y,
        width: output.width,
        height: output.height,
        refresh_hz: output.refresh_hz,
        scale_factor: output.scale,
        primary: output.primary,
        virtual_display,
    }
}

fn x11_info(output: &x11::Output, virtual_display: bool) -> Option<DisplayInfo> {
    let (width, height, x, y) = output.geometry?;
    Some(DisplayInfo {
        id: output.name.clone(),
        name: output.name.clone(),
        x,
        y,
        width,
        height,
        refresh_hz: output.refresh_hz.unwrap_or(60),
        scale_factor: 1.0,
        primary: output.primary,
        virtual_display,
    })
}

impl DisplayBackend for CompositorBackend {
    fn info(&self) -> BackendInfo {
        let ready = |scaling| BackendInfo {
            name: self.strategy.map_or("unknown", Strategy::name).into(),
            ready: true,
            reason: None,
            capabilities: Capabilities {
                virtual_display: true,
                resize: true,
                scaling,
                ..Capabilities::default()
            },
        };
        let not_ready = |reason: &str| BackendInfo {
            name: self.strategy.map_or("unknown", Strategy::name).into(),
            ready: false,
            reason: Some(reason.to_owned()),
            capabilities: Capabilities::default(),
        };
        match self.strategy {
            Some(Strategy::Sway | Strategy::Hyprland) => ready(true),
            // X scales the whole screen, not one output.
            Some(Strategy::X11) => ready(false),
            Some(Strategy::Mutter) => not_ready(
                "a virtual monitor on GNOME needs Mutter's screen-cast API, which ShiftPane doesn't use yet; a Sway, Hyprland or X11 session works",
            ),
            Some(Strategy::KWin) => not_ready(
                "a virtual monitor on KDE Plasma needs KWin's screen-cast protocol, which ShiftPane doesn't use yet; a Sway, Hyprland or X11 session works",
            ),
            None => not_ready(
                "unrecognised desktop session; set XDG_SESSION_TYPE and XDG_CURRENT_DESKTOP",
            ),
        }
    }

    fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError> {
        let ours = |name: &str| self.output.as_deref() == Some(name);
        match self.strategy {
            Some(strategy @ (Strategy::Sway | Strategy::Hyprland)) => {
                let compositor = strategy
                    .compositor()
                    .ok_or_else(|| internal("no compositor"))?;
                let (program, args) = compositor.list_command();
                Ok(compositor
                    .parse_outputs(&run(program, &args)?)
                    .into_iter()
                    .map(|output| {
                        let virtual_display = ours(&output.name);
                        wlroots_info(output, virtual_display)
                    })
                    .collect())
            }
            Some(Strategy::X11) => Ok(x11::parse_outputs(&run("xrandr", &["--query".into()])?)
                .iter()
                .filter_map(|output| x11_info(output, ours(&output.name)))
                .collect()),
            _ => Err(HelperError::unsupported(
                "this desktop session has no display backend yet",
            )),
        }
    }

    fn attach(&mut self, mode: Mode) -> Result<DisplayInfo, HelperError> {
        match self.strategy {
            Some(strategy @ (Strategy::Sway | Strategy::Hyprland)) => {
                let compositor = strategy
                    .compositor()
                    .ok_or_else(|| internal("no compositor"))?;
                self.attach_wlroots(compositor, mode)
            }
            Some(Strategy::X11) => self.attach_x11(mode),
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
        let Some(name) = self.output.take() else {
            return Ok(());
        };
        match self.strategy {
            Some(strategy @ (Strategy::Sway | Strategy::Hyprland)) => {
                let compositor = strategy
                    .compositor()
                    .ok_or_else(|| internal("no compositor"))?;
                let (program, args) = compositor.remove_command(&name);
                run(program, &args).map(|_| ())
            }
            Some(Strategy::X11) => {
                run("xrandr", &["--output".into(), name.clone(), "--off".into()])?;
                if let Some(mode) = self.x11_mode.take() {
                    drop_x11_mode(&name, &mode);
                }
                Ok(())
            }
            _ => Ok(()),
        }
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
            Some(Strategy::Sway)
        );
        assert_eq!(
            Strategy::detect(Some("wayland"), Some("Hyprland")),
            Some(Strategy::Hyprland)
        );
        assert_eq!(
            Strategy::detect(Some("x11"), Some("XFCE")),
            Some(Strategy::X11)
        );
        assert_eq!(Strategy::detect(Some("tty"), None), None);
        assert_eq!(Strategy::detect(Some("wayland"), Some("river")), None);
    }

    #[test]
    fn says_which_sessions_work_where_it_cannot_make_a_monitor() {
        let backend = |strategy| CompositorBackend {
            strategy: Some(strategy),
            output: None,
            x11_mode: None,
        };
        assert!(backend(Strategy::Sway).info().ready);
        assert!(backend(Strategy::Sway).info().capabilities.scaling);
        assert!(!backend(Strategy::X11).info().capabilities.scaling);
        let gnome = backend(Strategy::Mutter).info();
        assert!(!gnome.ready);
        assert!(
            gnome
                .reason
                .is_some_and(|reason| reason.contains("Sway, Hyprland or X11"))
        );
    }
}
