//! The battery, from the power status the battery icon reads.

use std::mem::zeroed;

use shiftpane_core::protocol::Battery;
use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

use crate::plan;

/// The battery, or `None` on a PC without one or when the OS can't say.
pub fn battery() -> Option<Battery> {
    // SAFETY: SYSTEM_POWER_STATUS is plain old data.
    let mut status: SYSTEM_POWER_STATUS = unsafe { zeroed() };
    // SAFETY: `status` is a valid out-parameter.
    if unsafe { GetSystemPowerStatus(&raw mut status) } == 0 {
        return None;
    }
    plan::battery(
        status.BatteryFlag,
        status.BatteryLifePercent,
        status.BatteryLifeTime,
    )
}
