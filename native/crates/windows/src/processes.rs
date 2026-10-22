//! The busiest programs, from the process counters (the source Task Manager's details read).

use std::num::NonZeroUsize;

use shiftpane_core::protocol::ProcessLoad;

use crate::counters::Counters;
use crate::plan;

const CPU: &str = r"\Process(*)\% Processor Time";
const MEMORY: &str = r"\Process(*)\Working Set - Private";
/// Most programs listed; widgets show a handful.
const LIMIT: usize = 10;

/// The process query, opened on first use.
#[derive(Debug, Default)]
pub struct Processes {
    counters: Option<Counters>,
    opened: bool,
}

impl Processes {
    pub fn read(&mut self) -> Vec<ProcessLoad> {
        if !self.opened {
            self.opened = true;
            self.counters = Counters::open(&[CPU, MEMORY]);
        }
        let Some(counters) = self.counters.as_mut() else {
            return Vec::new();
        };
        let mut samples = counters.sample().into_iter();
        let cpu = samples.next().flatten().unwrap_or_default();
        let memory = samples.next().flatten().unwrap_or_default();
        let cores = std::thread::available_parallelism()
            .map_or(1, NonZeroUsize::get)
            .try_into()
            .unwrap_or(u32::MAX);
        plan::top_processes(&cpu, &memory, cores, LIMIT)
    }
}
