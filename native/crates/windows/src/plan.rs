//! Decisions the Windows backend makes, kept free of Win32 calls so they are tested on every OS.

use shiftpane_core::mode::{MAX_HEIGHT, MAX_PREPARE_SIZES, MAX_WIDTH, MIN_HEIGHT, MIN_WIDTH};

/// How the driver's adapter is described in Windows (the INF's device description).
pub const ADAPTER_DESCRIPTION: &str = "Virtual Display Driver";
/// The monitor id the driver reports (`MONITOR\MTT1337\...`); used when the adapter string
/// is localised or overridden.
pub const MONITOR_ID_MARK: &str = "MTT1337";

/// How many sizes one elevated run may add: everything one `display.prepare` can list.
pub const MAX_MODES_PER_CALL: usize = MAX_PREPARE_SIZES;

/// Exit codes of the elevated `apply-modes` process. The parent cannot read its output (it
/// runs through a UAC prompt), so the code is the whole report.
pub mod exit {
    pub const OK: i32 = 0;
    pub const BAD_ARGS: i32 = 2;
    pub const SETTINGS: i32 = 3;
    pub const NO_DEVICE: i32 = 4;
    pub const RESTART_FAILED: i32 = 5;
}

/// True for the display this backend drives, as opposed to the user's real monitors.
pub fn is_virtual_display(adapter_description: &str, monitor_id: &str) -> bool {
    adapter_description
        .trim()
        .eq_ignore_ascii_case(ADAPTER_DESCRIPTION)
        || monitor_id.to_ascii_uppercase().contains(MONITOR_ID_MARK)
}

/// True for the `PnP` hardware id the driver's device node carries (`Root\MttVDD`).
pub fn is_driver_hardware_id(id: &str) -> bool {
    let id = id.trim().to_ascii_uppercase();
    id == r"ROOT\MTTVDD" || id == "MTTVDD"
}

/// The sizes in `wanted` the driver does not list yet, in request order and without
/// duplicates. `offered` holds `(width, height, refresh)` for every mode the driver reports,
/// so a size counts as present at any refresh rate.
pub fn missing_sizes(offered: &[(u32, u32, u32)], wanted: &[(u32, u32)]) -> Vec<(u32, u32)> {
    let mut missing: Vec<(u32, u32)> = Vec::new();
    for &size in wanted {
        let listed = offered.iter().any(|&(w, h, _)| (w, h) == size);
        if !listed && !missing.contains(&size) {
            missing.push(size);
        }
    }
    missing
}

/// The refresh rate to apply: the requested one when the driver offers it for this size,
/// otherwise the closest (the higher one on a tie).
pub fn pick_refresh(available: &[u32], wanted: u32) -> Option<u32> {
    available
        .iter()
        .copied()
        .min_by_key(|&hz| (hz.abs_diff(wanted), std::cmp::Reverse(hz)))
}

/// Where to put a monitor that is not on the desktop yet: just right of everything else,
/// top-aligned. `others` holds `(x, y, width, height)` of the displays already attached.
pub fn place_right_of(others: &[(i32, i32, u32, u32)]) -> (i32, i32) {
    let right = others
        .iter()
        .map(|&(x, _, width, _)| x.saturating_add(i32::try_from(width).unwrap_or(i32::MAX)))
        .max()
        .unwrap_or(0);
    (right.max(0), 0)
}

/// Parses the elevated process's arguments: an even count of plain decimal numbers,
/// `WIDTH HEIGHT [WIDTH HEIGHT ...]`. Nothing else is accepted, so the elevated step can
/// never be made to do anything but add resolutions.
pub fn parse_mode_args(args: &[String]) -> Result<Vec<(u32, u32)>, String> {
    if args.is_empty() || !args.len().is_multiple_of(2) {
        return Err("expected WIDTH HEIGHT pairs".into());
    }
    if args.len() / 2 > MAX_MODES_PER_CALL {
        return Err(format!("at most {MAX_MODES_PER_CALL} sizes per call"));
    }
    let number = |text: &str| -> Result<u32, String> {
        if text.is_empty() || text.len() > 5 || !text.bytes().all(|b| b.is_ascii_digit()) {
            return Err(format!("{text:?} is not a plain number"));
        }
        text.parse::<u32>().map_err(|e| e.to_string())
    };
    let mut sizes = Vec::with_capacity(args.len() / 2);
    // The length is even (checked above), so there is no remainder to drop.
    let (pairs, _) = args.as_chunks::<2>();
    for [width, height] in pairs {
        let (width, height) = (number(width)?, number(height)?);
        if !(MIN_WIDTH..=MAX_WIDTH).contains(&width) || !(MIN_HEIGHT..=MAX_HEIGHT).contains(&height)
        {
            return Err(format!("{width}x{height} is out of range"));
        }
        if !width.is_multiple_of(2) || !height.is_multiple_of(2) {
            return Err(format!("{width}x{height} must have even dimensions"));
        }
        sizes.push((width, height));
    }
    Ok(sizes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn recognises_the_virtual_display_by_adapter_or_monitor_id() {
        assert!(is_virtual_display("Virtual Display Driver", ""));
        assert!(is_virtual_display(" virtual display driver ", ""));
        assert!(is_virtual_display(
            "Something else",
            r"MONITOR\MTT1337\{4d36e96e-e325-11ce-bfc1-08002be10318}\0006"
        ));
        assert!(!is_virtual_display(
            "Intel(R) UHD Graphics",
            r"MONITOR\BOE0BB2\{4d36e96e-e325-11ce-bfc1-08002be10318}\0004"
        ));
    }

    #[test]
    fn recognises_the_driver_hardware_id() {
        assert!(is_driver_hardware_id(r"Root\MttVDD"));
        assert!(is_driver_hardware_id("MttVDD"));
        assert!(!is_driver_hardware_id(r"PCI\VEN_8086&DEV_9A49"));
        assert!(!is_driver_hardware_id(r"Root\IddSampleDriver"));
    }

    #[test]
    fn picks_the_requested_refresh_or_the_nearest() {
        let offered = [30, 60, 90, 120, 144, 165, 244];
        assert_eq!(pick_refresh(&offered, 60), Some(60));
        assert_eq!(pick_refresh(&offered, 100), Some(90));
        assert_eq!(
            pick_refresh(&offered, 75),
            Some(90),
            "tie goes to the higher rate"
        );
        assert_eq!(pick_refresh(&offered, 24), Some(30));
        assert_eq!(pick_refresh(&[], 60), None);
    }

    #[test]
    fn finds_the_sizes_the_driver_does_not_list() {
        // The same size at two refresh rates counts once, and any rate counts as listed.
        let offered = [(1920, 1080, 30), (1920, 1080, 60), (1440, 1080, 60)];
        assert_eq!(
            missing_sizes(
                &offered,
                &[(1440, 1080), (1080, 1440), (1920, 1080), (1080, 1440)]
            ),
            vec![(1080, 1440)]
        );
        assert_eq!(missing_sizes(&offered, &[(1920, 1080)]), Vec::new());
        assert_eq!(missing_sizes(&[], &[(1440, 1080)]), vec![(1440, 1080)]);
        // One elevated run is enough for everything a phone can ask for.
        const { assert!(MAX_MODES_PER_CALL >= 12) };
    }

    #[test]
    fn places_a_new_monitor_right_of_the_others() {
        assert_eq!(place_right_of(&[]), (0, 0));
        let others = [
            (0, 0, 1920, 1080),
            (1920, 0, 1920, 1080),
            (3840, 0, 1920, 1200),
        ];
        assert_eq!(place_right_of(&others), (5760, 0));
        // A monitor to the left of the primary must not pull the result negative.
        assert_eq!(place_right_of(&[(-1920, 0, 1920, 1080)]), (0, 0));
    }

    #[test]
    fn parses_plain_size_pairs() {
        assert_eq!(
            parse_mode_args(&args(&["1440", "1080", "1680", "1050"])),
            Ok(vec![(1440, 1080), (1680, 1050)])
        );
    }

    #[test]
    fn refuses_anything_that_is_not_a_plain_even_size_in_range() {
        for bad in [
            args(&[]),
            args(&["1440"]),
            args(&["1440", "1080", "800"]),
            args(&["1440", "10x80"]),
            args(&["+1440", "1080"]),
            args(&["1440", "-1080"]),
            args(&["14 40", "1080"]),
            args(&["1441", "1080"]),
            args(&["639", "480"]),
            args(&["99999", "1080"]),
            args(&["cmd.exe", "1080"]),
        ] {
            assert!(parse_mode_args(&bad).is_err(), "{bad:?}");
        }
        let too_many: Vec<String> = (0..=MAX_MODES_PER_CALL)
            .flat_map(|_| ["1440".to_owned(), "1080".to_owned()])
            .collect();
        assert!(parse_mode_args(&too_many).is_err());
    }
}
