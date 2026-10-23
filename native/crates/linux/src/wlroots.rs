//! wlroots compositors: a headless output, which Sway and Hyprland create on demand.
//!
//! Sway: `swaymsg create_output` adds `HEADLESS-n`, `swaymsg output <name> mode ... position ...
//! scale ...` sets it up, and `swaymsg output <name> unplug` removes it. Hyprland: `hyprctl output
//! create headless`, `hyprctl keyword monitor <name>,<mode>,<position>,<scale>`, and `hyprctl
//! output remove <name>`. Both list their outputs as JSON, which is how the new one is found and
//! how the monitor reports where it ended up.

use serde_json::Value;

/// Which compositor's commands to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compositor {
    Sway,
    Hyprland,
}

/// One output as the compositor lists it.
#[derive(Debug, Clone, PartialEq)]
pub struct Output {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub refresh_hz: u32,
    pub scale: f64,
    pub primary: bool,
}

impl Compositor {
    /// The program and arguments that list the outputs as JSON.
    pub fn list_command(self) -> (&'static str, Vec<String>) {
        match self {
            Self::Sway => (
                "swaymsg",
                vec!["-t".into(), "get_outputs".into(), "-r".into()],
            ),
            Self::Hyprland => (
                "hyprctl",
                vec!["-j".into(), "monitors".into(), "all".into()],
            ),
        }
    }

    /// Adds a headless output.
    pub fn create_command(self) -> (&'static str, Vec<String>) {
        match self {
            Self::Sway => ("swaymsg", vec!["create_output".into()]),
            Self::Hyprland => (
                "hyprctl",
                vec!["output".into(), "create".into(), "headless".into()],
            ),
        }
    }

    /// Puts `name` at a size, refresh rate, position and scale.
    pub fn configure_command(
        self,
        name: &str,
        mode: (u32, u32, u32),
        x: i32,
        scale: f64,
    ) -> (&'static str, Vec<String>) {
        let (width, height, hz) = mode;
        match self {
            Self::Sway => (
                "swaymsg",
                vec![
                    "output".into(),
                    name.into(),
                    "mode".into(),
                    format!("{width}x{height}@{hz}Hz"),
                    "position".into(),
                    x.to_string(),
                    "0".into(),
                    "scale".into(),
                    format!("{scale}"),
                ],
            ),
            Self::Hyprland => (
                "hyprctl",
                vec![
                    "keyword".into(),
                    "monitor".into(),
                    format!("{name},{width}x{height}@{hz},{x}x0,{scale}"),
                ],
            ),
        }
    }

    /// Removes the headless output `name`.
    pub fn remove_command(self, name: &str) -> (&'static str, Vec<String>) {
        match self {
            Self::Sway => (
                "swaymsg",
                vec!["output".into(), name.into(), "unplug".into()],
            ),
            Self::Hyprland => (
                "hyprctl",
                vec!["output".into(), "remove".into(), name.into()],
            ),
        }
    }

    /// Reads the output list the list command printed.
    pub fn parse_outputs(self, json: &str) -> Vec<Output> {
        let Ok(Value::Array(items)) = serde_json::from_str::<Value>(json) else {
            return Vec::new();
        };
        items
            .iter()
            .filter_map(|item| match self {
                Self::Sway => sway_output(item),
                Self::Hyprland => hyprland_output(item),
            })
            .collect()
    }
}

fn int(value: &Value) -> Option<i32> {
    value.as_i64().and_then(|n| i32::try_from(n).ok())
}

fn uint(value: &Value) -> Option<u32> {
    value.as_u64().and_then(|n| u32::try_from(n).ok())
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn hz(rate: f64) -> u32 {
    // A refresh rate is a small positive number.
    rate.round().max(0.0) as u32
}

/// Sway: `{ name, active, rect: {x, y, width, height}, current_mode: {refresh (mHz)}, scale }`.
/// Inactive outputs have no rectangle worth reporting.
fn sway_output(item: &Value) -> Option<Output> {
    if item["active"].as_bool() == Some(false) {
        return None;
    }
    let rect = &item["rect"];
    let scale = item["scale"].as_f64().unwrap_or(1.0);
    // The rectangle is in logical pixels; the monitor reports physical ones, like Windows.
    let physical = |value: u32| {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let scaled = (f64::from(value) * scale).round() as u32;
        scaled
    };
    let refresh = item["current_mode"]["refresh"].as_f64().unwrap_or(60_000.0) / 1000.0;
    Some(Output {
        name: item["name"].as_str()?.to_owned(),
        x: int(&rect["x"])?,
        y: int(&rect["y"])?,
        width: physical(uint(&rect["width"])?),
        height: physical(uint(&rect["height"])?),
        refresh_hz: hz(refresh),
        scale,
        primary: item["focused"].as_bool().unwrap_or(false),
    })
}

/// Hyprland: `{ name, width, height, refreshRate, x, y, scale, focused, disabled }`, in pixels.
fn hyprland_output(item: &Value) -> Option<Output> {
    if item["disabled"].as_bool() == Some(true) {
        return None;
    }
    Some(Output {
        name: item["name"].as_str()?.to_owned(),
        x: int(&item["x"])?,
        y: int(&item["y"])?,
        width: uint(&item["width"])?,
        height: uint(&item["height"])?,
        refresh_hz: hz(item["refreshRate"].as_f64().unwrap_or(60.0)),
        scale: item["scale"].as_f64().unwrap_or(1.0),
        primary: item["focused"].as_bool().unwrap_or(false),
    })
}

/// The output that is new in `after`: the headless one just created.
pub fn new_output(before: &[Output], after: &[Output]) -> Option<String> {
    after
        .iter()
        .find(|output| !before.iter().any(|old| old.name == output.name))
        .map(|output| output.name.clone())
}

/// Just right of every other output, in the compositor's layout coordinates.
pub fn right_of(outputs: &[Output], except: &str) -> i32 {
    outputs
        .iter()
        .filter(|output| output.name != except)
        .map(|output| {
            // Layout coordinates are logical, so a scaled output takes less room.
            #[allow(clippy::cast_possible_truncation)]
            let logical = (f64::from(output.width) / output.scale.max(0.1)).round() as i32;
            output.x.saturating_add(logical)
        })
        .max()
        .unwrap_or(0)
        .max(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SWAY: &str = r#"[
      {"name": "eDP-1", "active": true, "focused": true, "scale": 1.5,
       "rect": {"x": 0, "y": 0, "width": 1280, "height": 800},
       "current_mode": {"width": 1920, "height": 1200, "refresh": 60001}},
      {"name": "HEADLESS-1", "active": true, "focused": false, "scale": 2.0,
       "rect": {"x": 1280, "y": 0, "width": 1200, "height": 540},
       "current_mode": {"width": 2400, "height": 1080, "refresh": 60000}},
      {"name": "HDMI-A-1", "active": false}
    ]"#;

    const HYPRLAND: &str = r#"[
      {"name": "DP-1", "width": 2560, "height": 1440, "refreshRate": 143.99, "x": 0, "y": 0,
       "scale": 1.0, "focused": true, "disabled": false},
      {"name": "HEADLESS-2", "width": 2400, "height": 1080, "refreshRate": 60.0, "x": 2560,
       "y": 0, "scale": 2.0, "focused": false, "disabled": false}
    ]"#;

    #[test]
    fn reads_sway_outputs_in_physical_pixels() {
        let outputs = Compositor::Sway.parse_outputs(SWAY);
        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0].width, 1920);
        assert_eq!(outputs[1].name, "HEADLESS-1");
        assert_eq!((outputs[1].width, outputs[1].height), (2400, 1080));
        assert_eq!(outputs[1].refresh_hz, 60);
        assert!(outputs[0].primary);
    }

    #[test]
    fn reads_hyprland_monitors() {
        let outputs = Compositor::Hyprland.parse_outputs(HYPRLAND);
        assert_eq!(outputs[0].refresh_hz, 144);
        assert_eq!(outputs[1].x, 2560);
        assert_eq!(Compositor::Hyprland.parse_outputs("not json"), Vec::new());
    }

    #[test]
    fn finds_the_new_output_and_the_room_right_of_the_others() {
        let after = Compositor::Sway.parse_outputs(SWAY);
        let before = &after[..1];
        assert_eq!(new_output(before, &after).as_deref(), Some("HEADLESS-1"));
        // eDP-1 is 1920 pixels at 1.5x: 1280 logical.
        assert_eq!(right_of(&after, "HEADLESS-1"), 1280);
    }

    #[test]
    fn builds_each_compositors_commands() {
        let (program, args) =
            Compositor::Sway.configure_command("HEADLESS-1", (2400, 1080, 60), 1280, 2.5);
        assert_eq!(program, "swaymsg");
        assert_eq!(
            args.join(" "),
            "output HEADLESS-1 mode 2400x1080@60Hz position 1280 0 scale 2.5"
        );
        let (program, args) =
            Compositor::Hyprland.configure_command("HEADLESS-2", (2400, 1080, 60), 2560, 2.0);
        assert_eq!(program, "hyprctl");
        assert_eq!(
            args.join(" "),
            "keyword monitor HEADLESS-2,2400x1080@60,2560x0,2"
        );
        assert_eq!(
            Compositor::Hyprland
                .remove_command("HEADLESS-2")
                .1
                .join(" "),
            "output remove HEADLESS-2"
        );
    }
}
