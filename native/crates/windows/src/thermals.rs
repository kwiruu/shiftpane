//! GPU temperature and fan speed, as each display driver reports them to the graphics kernel
//! (the readings Task Manager shows). Needs no vendor library and no rights; a driver that
//! doesn't report them leaves them null. CPU temperature has no such interface on Windows.

use std::mem::size_of;
use std::ptr::from_mut;

use windows_sys::Wdk::Graphics::Direct3D::{
    D3DKMT_ADAPTER_PERFDATA, D3DKMT_ADAPTERINFO, D3DKMT_CLOSEADAPTER, D3DKMT_ENUMADAPTERS2,
    D3DKMT_QUERYADAPTERINFO, D3DKMTCloseAdapter, D3DKMTEnumAdapters2, D3DKMTQueryAdapterInfo,
    KMTQAITYPE_ADAPTERPERFDATA,
};

use crate::plan;

/// The hottest adapter's temperature in °C and the fastest fan in RPM, where reported.
pub fn gpu() -> (Option<f64>, Option<f64>) {
    let adapters = adapters();
    let mut temperature: Option<f64> = None;
    let mut fan: Option<f64> = None;
    for adapter in &adapters {
        if let Some(data) = perf_data(adapter.hAdapter) {
            if let Some(degrees) = plan::deci_celsius(data.Temperature) {
                temperature = Some(temperature.map_or(degrees, |t| t.max(degrees)));
            }
            if data.FanRPM > 0 {
                let rpm = f64::from(data.FanRPM);
                fan = Some(fan.map_or(rpm, |f| f.max(rpm)));
            }
        }
    }
    for adapter in adapters {
        let close = D3DKMT_CLOSEADAPTER {
            hAdapter: adapter.hAdapter,
        };
        // SAFETY: each handle came from D3DKMTEnumAdapters2 and is closed once.
        unsafe { D3DKMTCloseAdapter(&raw const close) };
    }
    (temperature, fan)
}

/// Every adapter the graphics kernel knows, opened. The caller closes them.
fn adapters() -> Vec<D3DKMT_ADAPTERINFO> {
    let mut query = D3DKMT_ENUMADAPTERS2::default();
    // SAFETY: a null array asks for the count only.
    if unsafe { D3DKMTEnumAdapters2(&raw mut query) } != 0 || query.NumAdapters == 0 {
        return Vec::new();
    }
    let count = usize::try_from(query.NumAdapters).unwrap_or(0);
    let mut list = vec![D3DKMT_ADAPTERINFO::default(); count];
    query.pAdapters = list.as_mut_ptr();
    // SAFETY: `list` holds `NumAdapters` entries and outlives the call.
    if unsafe { D3DKMTEnumAdapters2(&raw mut query) } != 0 {
        return Vec::new();
    }
    list.truncate(usize::try_from(query.NumAdapters).unwrap_or(0));
    list
}

fn perf_data(adapter: u32) -> Option<D3DKMT_ADAPTER_PERFDATA> {
    let mut data = D3DKMT_ADAPTER_PERFDATA::default();
    let mut query = D3DKMT_QUERYADAPTERINFO {
        hAdapter: adapter,
        Type: KMTQAITYPE_ADAPTERPERFDATA,
        pPrivateDriverData: from_mut(&mut data).cast(),
        PrivateDriverDataSize: u32::try_from(size_of::<D3DKMT_ADAPTER_PERFDATA>()).ok()?,
    };
    // SAFETY: `query` points at `data`, which is the size it says and outlives the call.
    let status = unsafe { D3DKMTQueryAdapterInfo(&raw mut query) };
    (status == 0).then_some(data)
}
