//! A small query of wildcard performance counters, for readings sampled on demand: drives'
//! reads and writes, and each process's CPU and memory. Rates are measured between two
//! collections, so the first collection after opening has none yet.

use std::ptr::{null, null_mut};

use windows_sys::Win32::System::Performance::{
    PDH_HCOUNTER, PDH_HQUERY, PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData,
    PdhOpenQueryW,
};

use crate::stats::{to_wide, values};

/// An open query of wildcard counters. Not `Send`: the helper uses it from its one thread.
#[derive(Debug)]
pub struct Counters {
    query: PDH_HQUERY,
    handles: Vec<Option<PDH_HCOUNTER>>,
    collected: bool,
}

impl Counters {
    /// Opens a query of the counters at `paths` (English names). `None` when the counter
    /// service can't be reached.
    pub fn open(paths: &[&str]) -> Option<Self> {
        let mut query: PDH_HQUERY = null_mut();
        // SAFETY: a null data source means live data; `query` is a valid out-pointer.
        if unsafe { PdhOpenQueryW(null(), 0, &raw mut query) } != 0 {
            return None;
        }
        let handles = paths
            .iter()
            .map(|path| {
                let wide = to_wide(path);
                let mut counter: PDH_HCOUNTER = null_mut();
                // SAFETY: `query` is open, `wide` is NUL-terminated, `counter` an out-pointer.
                let status =
                    unsafe { PdhAddEnglishCounterW(query, wide.as_ptr(), 0, &raw mut counter) };
                (status == 0).then_some(counter)
            })
            .collect();
        Some(Self {
            query,
            handles,
            collected: false,
        })
    }

    /// Collects once and reads every instance of each counter, in the order they were opened.
    /// The first collection has no rates yet, so it reads as `None` throughout.
    pub fn sample(&mut self) -> Vec<Option<Vec<(String, f64)>>> {
        // SAFETY: `self.query` stays open until drop.
        let ok = unsafe { PdhCollectQueryData(self.query) } == 0;
        let first = !self.collected;
        self.collected = true;
        self.handles
            .iter()
            .map(|counter| {
                if !ok || first {
                    return None;
                }
                counter.and_then(values)
            })
            .collect()
    }
}

impl Drop for Counters {
    fn drop(&mut self) {
        // SAFETY: closes the query opened in `open`, once.
        unsafe { PdhCloseQuery(self.query) };
    }
}
