//! X11: a mode made with `xrandr --newmode` on a spare output.
//!
//! X has no virtual monitors of its own, but the Intel and some other drivers expose spare
//! `VIRTUAL` outputs (and a disconnected connector sometimes takes a mode), so attach adds a
//! mode for the requested size, puts it on such an output right of everything else, and detach
//! turns the output off and drops the mode. X scales the whole screen, not one output, so this
//! backend can't scale.

/// One output from `xrandr --query`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    pub name: String,
    pub connected: bool,
    pub primary: bool,
    /// `(width, height, x, y)` while it shows something.
    pub geometry: Option<(u32, u32, i32, i32)>,
    /// The refresh rate of its current mode, when it has one.
    pub refresh_hz: Option<u32>,
}

/// Reads `xrandr --query`.
pub fn parse_outputs(query: &str) -> Vec<Output> {
    let mut outputs: Vec<Output> = Vec::new();
    for line in query.lines() {
        if line.starts_with("Screen ") {
            continue;
        }
        if line.starts_with(char::is_whitespace) {
            // A mode line; the current one is marked with `*`.
            if let Some(output) = outputs
                .last_mut()
                .filter(|output| output.refresh_hz.is_none())
            {
                output.refresh_hz = line
                    .split_whitespace()
                    .skip(1)
                    .find(|rate| rate.contains('*'))
                    .and_then(|rate| rate.trim_end_matches(['*', '+']).parse::<f64>().ok())
                    .map(rounded_hz);
            }
            continue;
        }
        let mut words = line.split_whitespace();
        let Some(name) = words.next() else { continue };
        let rest: Vec<&str> = words.collect();
        let connected = rest.first() == Some(&"connected");
        let primary = rest.contains(&"primary");
        let geometry = rest.iter().find_map(|word| parse_geometry(word));
        outputs.push(Output {
            name: name.to_owned(),
            connected,
            primary,
            geometry,
            refresh_hz: None,
        });
    }
    outputs
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn rounded_hz(hz: f64) -> u32 {
    // A refresh rate is a small positive number.
    hz.round() as u32
}

/// `1920x1080+0+0` as `(width, height, x, y)`.
fn parse_geometry(word: &str) -> Option<(u32, u32, i32, i32)> {
    let (size, position) = word.split_once('+')?;
    let (width, height) = size.split_once('x')?;
    let (x, y) = position.split_once('+')?;
    Some((
        width.parse().ok()?,
        height.parse().ok()?,
        x.parse().ok()?,
        y.parse().ok()?,
    ))
}

/// The output to put the monitor on: a `VIRTUAL` one first, then any other spare one.
pub fn pick_spare(outputs: &[Output]) -> Option<&Output> {
    let spare = |output: &&Output| !output.connected && output.geometry.is_none();
    outputs
        .iter()
        .filter(spare)
        .find(|output| output.name.to_ascii_uppercase().starts_with("VIRTUAL"))
        .or_else(|| outputs.iter().find(spare))
}

/// Just right of every output that shows something, top-aligned.
pub fn right_of(outputs: &[Output], except: &str) -> i32 {
    outputs
        .iter()
        .filter(|output| output.name != except)
        .filter_map(|output| output.geometry)
        .map(|(width, _, x, _)| x.saturating_add(i32::try_from(width).unwrap_or(i32::MAX)))
        .max()
        .unwrap_or(0)
        .max(0)
}

/// A mode line for `xrandr --newmode`, from VESA's CVT with reduced blanking (what `cvt -r`
/// prints), which every recent panel and virtual output accepts.
#[derive(Debug, Clone, PartialEq)]
pub struct Modeline {
    pub name: String,
    pub clock_mhz: f64,
    pub horizontal: [u32; 4],
    pub vertical: [u32; 4],
}

impl Modeline {
    /// `xrandr --newmode`'s arguments after the name.
    pub fn args(&self) -> Vec<String> {
        let mut args = vec![self.name.clone(), format!("{:.2}", self.clock_mhz)];
        args.extend(self.horizontal.iter().map(u32::to_string));
        args.extend(self.vertical.iter().map(u32::to_string));
        args.extend(["+hsync".to_owned(), "-vsync".to_owned()]);
        args
    }
}

/// CVT reduced blanking v1 for `width` x `height` at `hz`.
pub fn cvt_reduced(width: u32, height: u32, hz: u32) -> Modeline {
    const H_BLANK: u32 = 160;
    const H_FRONT_PORCH: u32 = 48;
    const H_SYNC: u32 = 32;
    const V_FRONT_PORCH: u32 = 3;
    const MIN_V_BACK_PORCH: u32 = 6;
    const MIN_V_BLANK_US: f64 = 460.0;
    const CLOCK_STEP_MHZ: f64 = 0.25;

    // Widths are whole character cells of 8 pixels.
    let width = width - width % 8;
    let v_sync = v_sync_lines(width, height);
    let hz = f64::from(hz.max(1));
    let h_period_us = (1_000_000.0 / hz - MIN_V_BLANK_US) / f64::from(height);
    let blank_lines = whole(MIN_V_BLANK_US / h_period_us) + 1;
    let v_blank = blank_lines.max(V_FRONT_PORCH + v_sync + MIN_V_BACK_PORCH);
    let h_total = width + H_BLANK;
    let v_total = height + v_blank;
    let clock = hz * f64::from(v_total) * f64::from(h_total) / 1_000_000.0;
    let clock_mhz = (clock / CLOCK_STEP_MHZ).floor() * CLOCK_STEP_MHZ;
    let h_sync_start = width + H_FRONT_PORCH;
    let v_sync_start = height + V_FRONT_PORCH;
    Modeline {
        name: format!("shiftpane-{width}x{height}-{}", whole(hz)),
        clock_mhz,
        horizontal: [width, h_sync_start, h_sync_start + H_SYNC, h_total],
        vertical: [height, v_sync_start, v_sync_start + v_sync, v_total],
    }
}

/// CVT's sync width, which encodes the aspect ratio: 10 lines for one it doesn't name.
fn v_sync_lines(width: u32, height: u32) -> u32 {
    let is = |w: u32, h: u32| width * h == height * w;
    if is(4, 3) {
        4
    } else if is(16, 9) {
        5
    } else if is(16, 10) {
        6
    } else if is(5, 4) || is(15, 9) {
        7
    } else {
        10
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn whole(value: f64) -> u32 {
    // Line counts and refresh rates: small and positive.
    value.floor() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUERY: &str = "\
Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 16384 x 16384
eDP-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 193mm
   1920x1080     60.02*+  59.93
   1680x1050     59.95
HDMI-1 disconnected (normal left inverted right x axis y axis)
VIRTUAL1 disconnected (normal left inverted right x axis y axis)
";

    #[test]
    fn reads_outputs_and_their_current_mode() {
        let outputs = parse_outputs(QUERY);
        assert_eq!(outputs.len(), 3);
        assert_eq!(
            outputs[0],
            Output {
                name: "eDP-1".into(),
                connected: true,
                primary: true,
                geometry: Some((1920, 1080, 0, 0)),
                refresh_hz: Some(60),
            }
        );
        assert!(!outputs[1].connected);
        assert_eq!(outputs[1].geometry, None);
    }

    #[test]
    fn prefers_a_virtual_output_and_goes_right_of_the_rest() {
        let outputs = parse_outputs(QUERY);
        assert_eq!(
            pick_spare(&outputs).map(|o| o.name.as_str()),
            Some("VIRTUAL1")
        );
        assert_eq!(right_of(&outputs, "VIRTUAL1"), 1920);
        let no_virtual: Vec<Output> = outputs
            .into_iter()
            .filter(|o| o.name != "VIRTUAL1")
            .collect();
        assert_eq!(
            pick_spare(&no_virtual).map(|o| o.name.as_str()),
            Some("HDMI-1")
        );
    }

    #[test]
    fn computes_the_same_mode_as_cvt_r() {
        // `cvt -r 1920 1080 60`: 138.50  1920 1968 2000 2080  1080 1083 1088 1111
        let mode = cvt_reduced(1920, 1080, 60);
        assert!((mode.clock_mhz - 138.5).abs() < f64::EPSILON);
        assert_eq!(mode.horizontal, [1920, 1968, 2000, 2080]);
        assert_eq!(mode.vertical, [1080, 1083, 1088, 1111]);
        // `cvt -r 2400 1080 60`: a phone's aspect, so a 10-line sync.
        let phone = cvt_reduced(2400, 1080, 60);
        assert_eq!(phone.vertical[2] - phone.vertical[1], 10);
        assert_eq!(phone.args()[0], "shiftpane-2400x1080-60");
        assert_eq!(phone.args().last().map(String::as_str), Some("-vsync"));
    }
}
