//! Fixed drives: space from the volume, reads and writes per second from the logical disk
//! counters.

use shiftpane_core::protocol::DriveInfo;
use windows_sys::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives,
};

use crate::counters::Counters;
use crate::plan;
use crate::stats::to_wide;

const READS: &str = r"\LogicalDisk(*)\Disk Read Bytes/sec";
const WRITES: &str = r"\LogicalDisk(*)\Disk Write Bytes/sec";
/// `GetDriveTypeW` for a fixed disk (not removable, network, optical or RAM).
const DRIVE_FIXED: u32 = 3;
/// Most drives listed.
const MAX_DRIVES: usize = 16;

/// The drives query, opened on first use.
#[derive(Debug, Default)]
pub struct Disks {
    counters: Option<Counters>,
    opened: bool,
}

impl Disks {
    pub fn read(&mut self) -> Vec<DriveInfo> {
        if !self.opened {
            self.opened = true;
            self.counters = Counters::open(&[READS, WRITES]);
        }
        let mut rates = self
            .counters
            .as_mut()
            .map(Counters::sample)
            .unwrap_or_default()
            .into_iter();
        let reads = rates.next().flatten().unwrap_or_default();
        let writes = rates.next().flatten().unwrap_or_default();
        fixed_drives()
            .into_iter()
            .take(MAX_DRIVES)
            .filter_map(|name| {
                let (total, free) = space(&name)?;
                Some(DriveInfo {
                    read_per_second: plan::drive_counter(&reads, &name),
                    write_per_second: plan::drive_counter(&writes, &name),
                    used_bytes: (total - free).max(0.0),
                    total_bytes: total,
                    name,
                })
            })
            .collect()
    }
}

/// `C:`, `D:`, ... for each fixed drive.
fn fixed_drives() -> Vec<String> {
    // SAFETY: no arguments; returns a bitmask of drive letters.
    let mask = unsafe { GetLogicalDrives() };
    (0..26_u8)
        .filter(|bit| mask & (1 << bit) != 0)
        .map(|bit| format!("{}:", char::from(b'A' + bit)))
        .filter(|name| {
            let root = to_wide(&format!("{name}\\"));
            // SAFETY: `root` is NUL-terminated.
            unsafe { GetDriveTypeW(root.as_ptr()) == DRIVE_FIXED }
        })
        .collect()
}

/// `(total, free)` bytes on a drive.
// Byte counts become f64 for the protocol; drive sizes are far below 2^53.
#[allow(clippy::cast_precision_loss)]
fn space(name: &str) -> Option<(f64, f64)> {
    let root = to_wide(&format!("{name}\\"));
    let mut free = 0_u64;
    let mut total = 0_u64;
    // SAFETY: `root` is NUL-terminated; the out-pointers are valid; the third may be null.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            root.as_ptr(),
            std::ptr::null_mut(),
            &raw mut total,
            &raw mut free,
        )
    };
    (ok != 0 && total > 0).then_some((total as f64, free as f64))
}
