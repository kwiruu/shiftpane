//! The default output device: its volume and mute, through the endpoint volume the volume
//! flyout uses, and its name.

use std::ptr::null;
use std::sync::Once;

use shiftpane_core::protocol::{AudioControlParams, AudioState};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, eConsole, eRender,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, STGM_READ,
};
use windows::core::{BOOL, Result};

/// Longest device name passed on.
const MAX_TEXT_CHARS: usize = 200;

/// COM on the helper's one thread. Already initialised (by `WinRT`, say) is fine too.
fn init() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // SAFETY: no reserved argument; the result only says whether COM was already set up.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    });
}

fn device() -> Result<IMMDevice> {
    init();
    // SAFETY: COM is initialised; the class and interface match.
    let devices: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    // SAFETY: plain query on a live enumerator.
    unsafe { devices.GetDefaultAudioEndpoint(eRender, eConsole) }
}

fn volume(device: &IMMDevice) -> Result<IAudioEndpointVolume> {
    // SAFETY: activates the endpoint volume interface on a live device.
    unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }
}

/// Everything that can be read; a PC with no output device reads as nothing.
pub fn state() -> AudioState {
    let Ok(device) = device() else {
        return AudioState::default();
    };
    let endpoint = volume(&device).ok();
    // SAFETY: plain queries on a live endpoint.
    let level = endpoint
        .as_ref()
        .and_then(|v| unsafe { v.GetMasterVolumeLevelScalar() }.ok());
    // SAFETY: as above.
    let muted = endpoint
        .as_ref()
        .and_then(|v| unsafe { v.GetMute() }.ok())
        .map(BOOL::as_bool);
    AudioState {
        volume_percent: level.map(|level| (f64::from(level) * 100.0).round().clamp(0.0, 100.0)),
        muted,
        device: name(&device),
    }
}

fn name(device: &IMMDevice) -> Option<String> {
    // SAFETY: plain queries on a live device and its property store.
    let store = unsafe { device.OpenPropertyStore(STGM_READ) }.ok()?;
    // SAFETY: as above.
    let value = unsafe { store.GetValue(&PKEY_Device_FriendlyName) }.ok()?;
    // SAFETY: `value` is a PROPVARIANT the store returned.
    let text = unsafe { PropVariantToStringAlloc(&raw const value) }.ok()?;
    // SAFETY: the allocation is a NUL-terminated wide string, freed once right after reading.
    let name = unsafe { text.to_string() }.ok();
    // SAFETY: as above.
    unsafe { CoTaskMemFree(Some(text.0.cast_const().cast())) };
    let name = name?;
    let trimmed = name.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(MAX_TEXT_CHARS).collect())
}

/// Mutes or unmutes, or sets the volume (0-100, already checked).
// The percent is 0-100, so the f32 holds it exactly enough for a volume.
#[allow(clippy::cast_possible_truncation)]
pub fn control(params: AudioControlParams) -> Result<()> {
    let endpoint = volume(&device()?)?;
    match params {
        AudioControlParams::ToggleMute => {
            // SAFETY: plain calls on a live endpoint; no event context.
            let muted = unsafe { endpoint.GetMute()? }.as_bool();
            // SAFETY: as above.
            unsafe { endpoint.SetMute(!muted, null()) }
        }
        AudioControlParams::SetVolume { percent } => {
            // SAFETY: as above.
            unsafe { endpoint.SetMasterVolumeLevelScalar((percent / 100.0) as f32, null()) }
        }
    }
}
