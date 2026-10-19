//! Decisions the Windows backend makes, kept free of Win32 calls so they are tested on every OS.

use shiftpane_core::mode::{MAX_HEIGHT, MAX_PREPARE_SIZES, MAX_WIDTH, MIN_HEIGHT, MIN_WIDTH};

/// How the driver's adapter is described in Windows (the INF's device description).
pub const ADAPTER_DESCRIPTION: &str = "Virtual Display Driver";
/// The monitor id the driver reports (`MONITOR\MTT1337\...`). Only used to spot the virtual
/// monitor cloned onto another adapter's output, never to pick the output to change: when
/// displays are duplicated, this monitor sits under the laptop's own output.
pub const MONITOR_ID_MARK: &str = "MTT1337";

/// How many sizes one elevated run may add: everything one `display.prepare` can list.
pub const MAX_MODES_PER_CALL: usize = MAX_PREPARE_SIZES;

/// The most resolutions the driver's list can hold. Measured on Virtual Display Driver 25.7.26
/// with its six stock refresh rates: 14 resolutions (98 modes) load, 15 (105 modes) leave the
/// monitor with no modes at all and no error, and the monitor vanishes from Windows until the
/// list is shortened. Nothing here may push the list past this line.
pub const MAX_LISTED_RESOLUTIONS: usize = 14;

/// Exit codes of the elevated `apply-modes` process. The parent cannot read its output (it
/// runs through a UAC prompt), so the code is the whole report.
pub mod exit {
    pub const OK: i32 = 0;
    pub const BAD_ARGS: i32 = 2;
    pub const SETTINGS: i32 = 3;
    pub const NO_DEVICE: i32 = 4;
    pub const RESTART_FAILED: i32 = 5;
    /// The driver restarted but did not offer the new sizes; the old list was put back.
    pub const REJECTED: i32 = 6;
    /// Adding the sizes would make the list longer than [`super::MAX_LISTED_RESOLUTIONS`].
    pub const TOO_MANY: i32 = 7;
}

/// How many distinct sizes the list would hold after adding `wanted` to `listed`.
pub fn list_len_after(listed: &[(u32, u32)], wanted: &[(u32, u32)]) -> usize {
    let mut all: Vec<(u32, u32)> = Vec::with_capacity(listed.len() + wanted.len());
    for &size in listed.iter().chain(wanted) {
        if !all.contains(&size) {
            all.push(size);
        }
    }
    all.len()
}

/// True for the output (GDI source) this backend drives, as opposed to the user's real
/// monitors. Decided by the output's own adapter only: its description, or its device id
/// (`Root\MttVDD`), which is not localised.
pub fn is_virtual_display(adapter_description: &str, adapter_device_id: &str) -> bool {
    adapter_description
        .trim()
        .eq_ignore_ascii_case(ADAPTER_DESCRIPTION)
        || is_driver_hardware_id(adapter_device_id)
}

/// True for the virtual monitor's device id, wherever Windows shows it.
pub fn is_virtual_monitor_id(monitor_id: &str) -> bool {
    monitor_id.to_ascii_uppercase().contains(MONITOR_ID_MARK)
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

/// GPU load from the `\GPU Engine(*engtype_3D)\Utilization Percentage` counter's instances:
/// the 3D engines are summed per adapter (instances name it with `luid_...`) and the busiest
/// adapter is reported, which is close to what Task Manager shows. `None` when there are no
/// samples to go on.
pub fn gpu_percent(samples: &[(String, f64)]) -> Option<f64> {
    let mut per_adapter: Vec<(&str, f64)> = Vec::new();
    for (name, value) in samples {
        let adapter = name.find("luid_").map_or(name.as_str(), |start| {
            let rest = &name[start..];
            &rest[..rest.find("_phys").unwrap_or(rest.len())]
        });
        match per_adapter.iter_mut().find(|(key, _)| *key == adapter) {
            Some((_, total)) => *total += value,
            None => per_adapter.push((adapter, *value)),
        }
    }
    per_adapter
        .into_iter()
        .map(|(_, total)| total.clamp(0.0, 100.0))
        .reduce(f64::max)
}

/// A readable app name from a media session's `SourceAppUserModelId`, e.g.
/// `Spotify.exe` or `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify` -> `Spotify`.
pub fn app_name(app_user_model_id: &str) -> Option<String> {
    let id = app_user_model_id.trim();
    let after_bang = id.rsplit('!').next().unwrap_or(id);
    let without_exe = after_bang
        .strip_suffix(".exe")
        .or_else(|| after_bang.strip_suffix(".EXE"))
        .unwrap_or(after_bang);
    let last = without_exe.rsplit('.').next().unwrap_or(without_exe).trim();
    (!last.is_empty()).then(|| last.to_owned())
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
    fn recognises_the_virtual_output_by_its_own_adapter() {
        assert!(is_virtual_display("Virtual Display Driver", ""));
        assert!(is_virtual_display(" virtual display driver ", ""));
        // A localised or renamed description still has the driver's device id.
        assert!(is_virtual_display(
            "Pilote d'affichage virtuel",
            r"Root\MttVDD"
        ));
        assert!(!is_virtual_display(
            "Intel(R) UHD Graphics",
            r"PCI\VEN_8086&DEV_46A3&SUBSYS_3E7319E5&REV_0C"
        ));
    }

    #[test]
    fn never_takes_the_laptop_output_for_the_virtual_one_when_duplicating() {
        // Measured: with displays duplicated, the virtual monitor's id is listed under the
        // laptop's output (\\.\DISPLAY1). Picking that output resized the laptop's screen.
        let intel = r"PCI\VEN_8086&DEV_46A3&SUBSYS_3E7319E5&REV_0C";
        assert!(!is_virtual_display("Intel(R) UHD Graphics", intel));
        assert!(is_virtual_monitor_id(
            r"MONITOR\MTT1337\{4d36e96e-e325-11ce-bfc1-08002be10318}\0006"
        ));
        assert!(!is_virtual_monitor_id(
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
    fn counts_the_list_length_after_adding_sizes() {
        let listed = [(800, 600), (1920, 1080)];
        assert_eq!(list_len_after(&listed, &[]), 2);
        assert_eq!(
            list_len_after(&listed, &[(1920, 1080)]),
            2,
            "already listed"
        );
        assert_eq!(
            list_len_after(&listed, &[(1440, 1080), (1440, 1080), (1280, 720)]),
            4,
            "duplicates in the request count once"
        );
        let full: Vec<(u32, u32)> = (0..MAX_LISTED_RESOLUTIONS)
            .map(|i| (800 + u32::try_from(i).unwrap_or(0) * 2, 600))
            .collect();
        assert_eq!(list_len_after(&full, &[]), MAX_LISTED_RESOLUTIONS);
        assert!(list_len_after(&full, &[(1000, 1000)]) > MAX_LISTED_RESOLUTIONS);
    }

    #[test]
    fn sums_3d_engines_per_adapter_and_reports_the_busiest() {
        let sample = |name: &str, value: f64| (name.to_owned(), value);
        let samples = [
            sample("pid_1_luid_0x0_0xA_phys_0_eng_0_engtype_3D", 20.0),
            sample("pid_2_luid_0x0_0xA_phys_0_eng_0_engtype_3D", 15.0),
            sample("pid_3_luid_0x0_0xB_phys_0_eng_0_engtype_3D", 30.0),
        ];
        assert_eq!(gpu_percent(&samples), Some(35.0));
        assert_eq!(
            gpu_percent(&[sample("luid_0x0_0xA_phys_0", 180.0)]),
            Some(100.0)
        );
        assert_eq!(gpu_percent(&[]), None);
    }

    #[test]
    fn makes_app_names_readable() {
        assert_eq!(app_name("Spotify.exe").as_deref(), Some("Spotify"));
        assert_eq!(
            app_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify").as_deref(),
            Some("Spotify")
        );
        assert_eq!(
            app_name("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic").as_deref(),
            Some("ZuneMusic")
        );
        assert_eq!(app_name("Chrome").as_deref(), Some("Chrome"));
        assert_eq!(app_name("  "), None);
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
