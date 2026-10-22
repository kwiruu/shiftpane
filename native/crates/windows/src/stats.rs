//! Load of the PC for the stats widget: Windows performance counters (the source Task Manager
//! reads) for CPU, GPU and network, and the memory status API for RAM.
//!
//! Counters are added by their English names, which work on every display language. Rates
//! (network bytes per second, GPU and CPU utilisation) are measured between two collections,
//! so the sampler lives as long as the helper and the first sample may have no rates yet.

use std::iter::once;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};

use shiftpane_core::protocol::SystemStats;
use windows_sys::Win32::System::Performance::{
    PDH_FMT_COUNTERVALUE, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
    PDH_MORE_DATA, PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData,
    PdhGetFormattedCounterArrayW, PdhGetFormattedCounterValue, PdhOpenQueryW,
};
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

use crate::{plan, thermals};

const CPU: &str = r"\Processor Information(_Total)\% Processor Utility";
const GPU_3D: &str = r"\GPU Engine(*engtype_3D)\Utilization Percentage";
const NET_IN: &str = r"\Network Interface(*)\Bytes Received/sec";
const NET_OUT: &str = r"\Network Interface(*)\Bytes Sent/sec";

/// `PDH_CSTATUS_VALID_DATA` and `PDH_CSTATUS_NEW_DATA`: a value that can be read.
const USABLE: u32 = 1;

pub(crate) fn to_wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(once(0)).collect()
}

/// An open counter query. Not `Send`: the helper uses it from its one thread.
#[derive(Debug)]
pub struct Sampler {
    query: PDH_HQUERY,
    cpu: Option<PDH_HCOUNTER>,
    gpu: Option<PDH_HCOUNTER>,
    net_in: Option<PDH_HCOUNTER>,
    net_out: Option<PDH_HCOUNTER>,
}

impl Sampler {
    /// Opens the query and takes the first collection. `None` when counters are unavailable
    /// (the performance counter service is off); memory is still read without them.
    pub fn new() -> Option<Self> {
        let mut query: PDH_HQUERY = null_mut();
        // SAFETY: a null data source means live data; `query` is a valid out-pointer.
        if unsafe { PdhOpenQueryW(null(), 0, &raw mut query) } != 0 {
            return None;
        }
        let add = |path: &str| -> Option<PDH_HCOUNTER> {
            let wide = to_wide(path);
            let mut counter: PDH_HCOUNTER = null_mut();
            // SAFETY: `query` is open, `wide` is NUL-terminated, `counter` is an out-pointer.
            let status =
                unsafe { PdhAddEnglishCounterW(query, wide.as_ptr(), 0, &raw mut counter) };
            (status == 0).then_some(counter)
        };
        let sampler = Self {
            query,
            cpu: add(CPU),
            gpu: add(GPU_3D),
            net_in: add(NET_IN),
            net_out: add(NET_OUT),
        };
        // Rates need two collections; this is the first.
        // SAFETY: `query` is open.
        unsafe { PdhCollectQueryData(query) };
        Some(sampler)
    }

    /// Collects once more and reports everything that could be read.
    pub fn sample(&mut self) -> SystemStats {
        // SAFETY: `self.query` stays open until drop.
        let collected = unsafe { PdhCollectQueryData(self.query) } == 0;
        let (memory_used_bytes, memory_total_bytes) = memory();
        if !collected {
            return SystemStats {
                memory_used_bytes,
                memory_total_bytes,
                ..SystemStats::default()
            };
        }
        let sum = |counter: Option<PDH_HCOUNTER>| {
            counter
                .and_then(values)
                .map(|items| items.iter().map(|(_, value)| value.max(0.0)).sum::<f64>())
        };
        let (gpu_temperature_celsius, gpu_fan_rpm) = thermals::gpu();
        SystemStats {
            cpu_percent: self.cpu.and_then(value).map(|v| v.clamp(0.0, 100.0)),
            memory_used_bytes,
            memory_total_bytes,
            gpu_percent: self
                .gpu
                .and_then(values)
                .and_then(|items| plan::gpu_percent(&items)),
            network_received_per_second: sum(self.net_in),
            network_sent_per_second: sum(self.net_out),
            gpu_temperature_celsius,
            gpu_fan_rpm,
        }
    }
}

impl Drop for Sampler {
    fn drop(&mut self) {
        // SAFETY: closes the query opened in `new`, once.
        unsafe { PdhCloseQuery(self.query) };
    }
}

/// One counter's value, when it has one.
fn value(counter: PDH_HCOUNTER) -> Option<f64> {
    // SAFETY: PDH_FMT_COUNTERVALUE is plain old data.
    let mut formatted: PDH_FMT_COUNTERVALUE = unsafe { zeroed() };
    // SAFETY: `counter` belongs to an open query; the type out-pointer may be null.
    let status = unsafe {
        PdhGetFormattedCounterValue(counter, PDH_FMT_DOUBLE, null_mut(), &raw mut formatted)
    };
    // SAFETY: with PDH_FMT_DOUBLE the double member is the one written; on failure the value
    // is still the zeroed one and is discarded.
    let number = unsafe { formatted.Anonymous.doubleValue };
    (status == 0 && formatted.CStatus <= USABLE).then_some(number)
}

/// Every instance of a wildcard counter, as `(instance name, value)`.
pub(crate) fn values(counter: PDH_HCOUNTER) -> Option<Vec<(String, f64)>> {
    let mut bytes = 0_u32;
    let mut count = 0_u32;
    // SAFETY: a null buffer with size 0 asks for the size needed.
    let status = unsafe {
        PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &raw mut bytes,
            &raw mut count,
            null_mut(),
        )
    };
    if status == 0 {
        return Some(Vec::new());
    }
    if status != PDH_MORE_DATA {
        return None;
    }
    // u64 storage keeps the items (pointers and doubles) 8-byte aligned.
    let words = usize::try_from(bytes).ok()?.div_ceil(size_of::<u64>());
    let mut buffer = vec![0_u64; words];
    let items = buffer.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
    // SAFETY: `buffer` holds at least `bytes` bytes, suitably aligned.
    let status = unsafe {
        PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &raw mut bytes,
            &raw mut count,
            items,
        )
    };
    if status != 0 {
        return None;
    }
    // SAFETY: PDH wrote `count` items at the start of `buffer`, which outlives this slice.
    let items = unsafe { std::slice::from_raw_parts(items, usize::try_from(count).ok()?) };
    Some(
        items
            .iter()
            .filter(|item| item.FmtValue.CStatus <= USABLE)
            // SAFETY: names point into `buffer` and are NUL-terminated; the double member is
            // the one written with PDH_FMT_DOUBLE.
            .map(|item| unsafe {
                (
                    wide_string(item.szName),
                    item.FmtValue.Anonymous.doubleValue,
                )
            })
            .collect(),
    )
}

/// # Safety
/// `text` must be null or point at a NUL-terminated UTF-16 string.
pub(crate) unsafe fn wide_string(text: *const u16) -> String {
    if text.is_null() {
        return String::new();
    }
    let mut len = 0;
    // SAFETY: the caller promises a terminator, so every read up to it is in bounds.
    unsafe {
        while *text.add(len) != 0 {
            len += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(text, len))
    }
}

/// What can be read without the counter query: memory only.
pub fn memory_only() -> SystemStats {
    let (memory_used_bytes, memory_total_bytes) = memory();
    SystemStats {
        memory_used_bytes,
        memory_total_bytes,
        ..SystemStats::default()
    }
}

/// `(used, total)` physical memory in bytes.
// Byte counts become f64 for the protocol; RAM sizes are far below 2^53.
#[allow(clippy::cast_precision_loss)]
fn memory() -> (Option<f64>, Option<f64>) {
    // SAFETY: MEMORYSTATUSEX is plain old data; dwLength is set before the call.
    let mut status: MEMORYSTATUSEX = unsafe { zeroed() };
    status.dwLength = u32::try_from(size_of::<MEMORYSTATUSEX>()).unwrap_or(u32::MAX);
    // SAFETY: `status` is a valid, correctly sized out-parameter.
    if unsafe { GlobalMemoryStatusEx(&raw mut status) } == 0 {
        return (None, None);
    }
    let total = status.ullTotalPhys;
    let used = total.saturating_sub(status.ullAvailPhys);
    (Some(used as f64), Some(total as f64))
}
