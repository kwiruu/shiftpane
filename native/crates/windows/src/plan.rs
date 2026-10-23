//! Decisions the Windows backend makes, kept free of Win32 calls so they are tested on every OS.

use shiftpane_core::mode::{MAX_HEIGHT, MAX_PREPARE_SIZES, MAX_WIDTH, MIN_HEIGHT, MIN_WIDTH};
use shiftpane_core::protocol::{Battery, ProcessLoad};

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

/// The scales Windows offers for a display (Settings > Display > Scale), in percent.
pub const SCALE_STEPS: [u32; 12] = [100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500];

/// The scale step nearest to `percent`; a tie goes to the smaller one.
pub fn nearest_scale(percent: u32) -> u32 {
    SCALE_STEPS
        .iter()
        .copied()
        .min_by_key(|&step| (step.abs_diff(percent), step))
        .unwrap_or(100)
}

/// Windows sets a display's scale as a number of steps from the one it recommends for it.
/// `min_rel` (zero or less) is how many steps 100% is below the recommended one, and `max_rel`
/// how many steps the largest it allows is above. The steps from the recommended scale to the one
/// nearest `percent`, within what it allows.
pub fn scale_steps(percent: u32, min_rel: i32, max_rel: i32) -> i32 {
    let recommended = i32::try_from(min_rel.unsigned_abs()).unwrap_or(0);
    let target = SCALE_STEPS
        .iter()
        .position(|&step| step == nearest_scale(percent))
        .and_then(|index| i32::try_from(index).ok())
        .unwrap_or(0);
    (target - recommended).clamp(min_rel.min(0), max_rel.max(0))
}

/// The percent a scale `rel` steps from the recommended one is.
pub fn scale_percent(rel: i32, min_rel: i32) -> u32 {
    let index = i64::from(min_rel.unsigned_abs()) + i64::from(rel);
    usize::try_from(index)
        .ok()
        .and_then(|index| SCALE_STEPS.get(index))
        .copied()
        .unwrap_or(100)
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

/// The program a process counter instance belongs to: `chrome#3` is `chrome`.
pub fn program_name(instance: &str) -> &str {
    instance.split_once('#').map_or(instance, |(name, _)| name)
}

/// The busiest programs from the process counters: a program's instances (`chrome`,
/// `chrome#1`, ...) added together, the `_Total` and `Idle` pseudo-processes left out, and CPU
/// as a share of the whole processor (the counter counts one core as 100). Busiest first, then
/// by memory, at most `limit`.
pub fn top_processes(
    cpu: &[(String, f64)],
    memory: &[(String, f64)],
    logical_cpus: u32,
    limit: usize,
) -> Vec<ProcessLoad> {
    let cores = f64::from(logical_cpus.max(1));
    let mut programs: Vec<ProcessLoad> = Vec::new();
    let mut entry = |name: &str| -> Option<usize> {
        if name.is_empty() || name == "_Total" || name == "Idle" {
            return None;
        }
        if let Some(index) = programs.iter().position(|p| p.name == name) {
            return Some(index);
        }
        programs.push(ProcessLoad {
            name: name.to_owned(),
            cpu_percent: 0.0,
            memory_bytes: None,
        });
        Some(programs.len() - 1)
    };
    let mut indexed: Vec<(usize, f64, bool)> = Vec::new();
    for (instance, value) in cpu {
        if let Some(index) = entry(program_name(instance)) {
            indexed.push((index, *value, true));
        }
    }
    for (instance, value) in memory {
        if let Some(index) = entry(program_name(instance)) {
            indexed.push((index, *value, false));
        }
    }
    for (index, value, is_cpu) in indexed {
        let program = &mut programs[index];
        if is_cpu {
            program.cpu_percent += value.max(0.0) / cores;
        } else {
            program.memory_bytes = Some(program.memory_bytes.unwrap_or(0.0) + value.max(0.0));
        }
    }
    for program in &mut programs {
        program.cpu_percent = program.cpu_percent.clamp(0.0, 100.0);
    }
    programs.sort_by(|a, b| {
        b.cpu_percent.total_cmp(&a.cpu_percent).then_with(|| {
            b.memory_bytes
                .unwrap_or(0.0)
                .total_cmp(&a.memory_bytes.unwrap_or(0.0))
        })
    });
    programs.truncate(limit);
    programs
}

/// `GetSystemPowerStatus` says there is no battery with this flag, and "unknown" with 255.
const NO_BATTERY: u8 = 128;
const UNKNOWN: u8 = 255;
const CHARGING: u8 = 8;

/// The battery from `GetSystemPowerStatus`'s fields, or `None` on a PC without one.
pub fn battery(battery_flag: u8, life_percent: u8, life_seconds: u32) -> Option<Battery> {
    if battery_flag == UNKNOWN || battery_flag & NO_BATTERY != 0 {
        return None;
    }
    Some(Battery {
        percent: (life_percent <= 100).then(|| f64::from(life_percent)),
        charging: battery_flag & CHARGING != 0,
        // u32::MAX: the OS can't tell, which it says whenever the PC is plugged in.
        minutes_left: (life_seconds != u32::MAX).then(|| (f64::from(life_seconds) / 60.0).round()),
    })
}

/// Degrees Celsius from a driver's tenths of a degree; zero means it reported nothing.
pub fn deci_celsius(value: u32) -> Option<f64> {
    (value > 0 && value < 2000).then(|| f64::from(value) / 10.0)
}

/// A drive's counter, by its instance name (`C:`); the `_Total` instance is never a drive.
pub fn drive_counter(samples: &[(String, f64)], drive: &str) -> Option<f64> {
    samples
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(drive))
        .map(|(_, value)| value.max(0.0))
}

/// The app's name from its executable: its file description when it has one ("Visual Studio
/// Code"), otherwise the file name without `.exe` ("Code").
pub fn exe_app_name(path: &str, description: Option<&str>) -> Option<String> {
    if let Some(described) = description.map(str::trim).filter(|d| !d.is_empty()) {
        return Some(described.to_owned());
    }
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let stem = file
        .strip_suffix(".exe")
        .or_else(|| file.strip_suffix(".EXE"))
        .unwrap_or(file)
        .trim();
    (!stem.is_empty()).then(|| stem.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn picks_the_scale_step_nearest_a_percent() {
        assert_eq!(nearest_scale(260), 250);
        // Halfway between two steps goes to the smaller.
        assert_eq!(nearest_scale(275), 250);
        assert_eq!(nearest_scale(290), 300);
        assert_eq!(nearest_scale(90), 100);
        assert_eq!(nearest_scale(1000), 500);
    }

    #[test]
    fn counts_scale_steps_from_the_recommended_one_within_what_windows_allows() {
        // Windows recommends 150% (100% is two steps below) and allows up to 225% (three above).
        assert_eq!(scale_steps(100, -2, 3), -2);
        assert_eq!(scale_steps(150, -2, 3), 0);
        assert_eq!(scale_steps(200, -2, 3), 2);
        assert_eq!(scale_steps(300, -2, 3), 3);
        assert_eq!(scale_percent(3, -2), 225);
        // Recommended 100%: nothing below it.
        assert_eq!(scale_steps(50, 0, 6), 0);
        assert_eq!(scale_percent(0, 0), 100);
        assert_eq!(scale_percent(4, 0), 200);
    }

    #[test]
    fn adds_up_a_programs_processes_and_shares_the_cpu_among_cores() {
        let cpu = vec![
            ("chrome".to_owned(), 40.0),
            ("chrome#1".to_owned(), 20.0),
            ("Code".to_owned(), 30.0),
            ("Idle".to_owned(), 700.0),
            ("_Total".to_owned(), 800.0),
        ];
        let memory = vec![
            ("chrome".to_owned(), 1.0e9),
            ("chrome#1".to_owned(), 5.0e8),
            ("Code".to_owned(), 7.0e8),
        ];
        let top = top_processes(&cpu, &memory, 8, 5);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].name, "chrome");
        assert!((top[0].cpu_percent - 7.5).abs() < 1e-9);
        assert_eq!(top[0].memory_bytes, Some(1.5e9));
        assert_eq!(top[1].name, "Code");
        assert_eq!(top_processes(&cpu, &memory, 8, 1).len(), 1);
    }

    #[test]
    fn reads_the_battery_or_its_absence() {
        assert_eq!(battery(128, 255, u32::MAX), None);
        assert_eq!(battery(255, 255, u32::MAX), None);
        let on_battery = battery(1, 82, 12_840).unwrap();
        assert_eq!(on_battery.percent, Some(82.0));
        assert!(!on_battery.charging);
        assert_eq!(on_battery.minutes_left, Some(214.0));
        let charging = battery(8 | 1, 40, u32::MAX).unwrap();
        assert!(charging.charging);
        assert_eq!(charging.minutes_left, None);
    }

    #[test]
    fn turns_tenths_of_a_degree_into_degrees() {
        assert_eq!(deci_celsius(0), None);
        assert_eq!(deci_celsius(645), Some(64.5));
        assert_eq!(deci_celsius(50_000), None);
    }

    #[test]
    fn finds_a_drives_counter_by_its_letter() {
        let samples = vec![("_Total".to_owned(), 9.0), ("C:".to_owned(), 4.0)];
        assert_eq!(drive_counter(&samples, "c:"), Some(4.0));
        assert_eq!(drive_counter(&samples, "D:"), None);
    }

    #[test]
    fn names_an_app_by_its_description_or_its_file() {
        assert_eq!(
            exe_app_name(
                r"C:\Program Files\VS Code\Code.exe",
                Some("Visual Studio Code")
            ),
            Some("Visual Studio Code".to_owned())
        );
        assert_eq!(
            exe_app_name(r"C:\Windows\explorer.exe", Some("  ")),
            Some("explorer".to_owned())
        );
        assert_eq!(exe_app_name("", None), None);
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
