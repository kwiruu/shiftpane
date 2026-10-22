//! Messages exchanged between the desktop app and the helper.
//!
//! Every type here derives [`TS`], and `cargo test` writes the matching TypeScript to
//! `packages/helper-client/src/bindings`, so both ends compile against one definition.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Bumped on any breaking change to the messages below, and when the desktop app starts
/// relying on a call an older helper lacks (2: `display.prepare`; 3: `system.stats`,
/// `media.state`, `media.control`; 4: `disks.state`, `processes.top`, `power.state`,
/// `audio.state`, `audio.control`, `window.active`). The desktop app compares it with
/// `HELPER_PROTOCOL_VERSION` in `packages/helper-client`.
pub const PROTOCOL_VERSION: u32 = 4;

/// One line from the desktop app.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, TS)]
#[ts(export)]
pub struct Request {
    pub id: u32,
    #[serde(flatten)]
    #[ts(flatten)]
    pub call: Call,
}

/// What the desktop app is asking for. Each variant maps to one fixed action; there is
/// deliberately no way to pass an arbitrary command through.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, TS)]
#[serde(tag = "method", content = "params")]
#[ts(export)]
pub enum Call {
    /// Handshake: versions, platform and what this machine's backend can do.
    #[serde(rename = "helper.hello")]
    Hello,
    /// Every monitor Windows/macOS/Linux currently reports, virtual ones included.
    #[serde(rename = "display.list")]
    ListDisplays,
    /// Create the virtual monitor, or resize it if it already exists.
    #[serde(rename = "display.attach")]
    Attach(AttachParams),
    /// Make sure the OS can switch the virtual monitor to each listed size without asking
    /// again. On Windows this is the one step that needs administrator approval, so the
    /// desktop app sends every size a phone can ask for in a single call: one prompt per
    /// phone instead of one per size. Does not create or move the monitor.
    #[serde(rename = "display.prepare")]
    PrepareDisplays(PrepareParams),
    /// Remove the virtual monitor; the OS moves its windows back to the other screens.
    #[serde(rename = "display.detach")]
    Detach,
    /// CPU, memory, GPU and network load, for the PC stats widget. Rates are measured since
    /// the previous call, so the first call after the helper starts may report them as null.
    #[serde(rename = "system.stats")]
    SystemStats,
    /// What the OS media controls say is playing.
    #[serde(rename = "media.state")]
    MediaState,
    /// Presses one of the OS media buttons on whatever is playing.
    #[serde(rename = "media.control")]
    MediaControl(MediaControlParams),
    /// Each fixed drive: space used and total, and bytes read and written per second since
    /// the previous call (null on the first).
    #[serde(rename = "disks.state")]
    Disks,
    /// The busiest programs right now, by CPU, measured since the previous call.
    #[serde(rename = "processes.top")]
    Processes,
    /// The battery, when the PC has one.
    #[serde(rename = "power.state")]
    Power,
    /// The default output device: its volume, whether it is muted, and its name.
    #[serde(rename = "audio.state")]
    AudioState,
    /// Changes the default output device's volume or mute. Nothing else.
    #[serde(rename = "audio.control")]
    AudioControl(AudioControlParams),
    /// The app in front and its window title.
    #[serde(rename = "window.active")]
    ActiveWindow,
}

/// The two things `audio.control` can do. There is no free-form command.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize, TS)]
#[serde(tag = "action", rename_all = "kebab-case")]
#[ts(export)]
pub enum AudioControlParams {
    ToggleMute,
    /// 0-100; anything else is refused.
    SetVolume {
        percent: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaControlParams {
    pub action: MediaAction,
}

/// The fixed set of media buttons. There is no free-form command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum MediaAction {
    PlayPause,
    Next,
    Previous,
}

/// Load of the PC. Each field is `None` when this OS or machine cannot report it.
/// Byte counts are `f64` so they reach TypeScript as plain numbers.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SystemStats {
    /// 0-100, the share of processor capacity in use (what Task Manager shows).
    pub cpu_percent: Option<f64>,
    pub memory_used_bytes: Option<f64>,
    pub memory_total_bytes: Option<f64>,
    /// 0-100, the busiest GPU's 3D engine load.
    pub gpu_percent: Option<f64>,
    pub network_received_per_second: Option<f64>,
    pub network_sent_per_second: Option<f64>,
    /// The hottest GPU, as its driver reports it (what Task Manager shows).
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gpu_temperature_celsius: Option<f64>,
    /// The fastest GPU fan, when the driver reports one.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gpu_fan_rpm: Option<f64>,
}

/// One fixed drive. Byte counts are `f64` so they reach TypeScript as plain numbers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DriveInfo {
    /// How the OS names it, e.g. `C:`.
    pub name: String,
    pub used_bytes: f64,
    pub total_bytes: f64,
    pub read_per_second: Option<f64>,
    pub write_per_second: Option<f64>,
}

/// One program's load, its processes added together.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProcessLoad {
    /// The program's name, e.g. `chrome`.
    pub name: String,
    /// 0-100, its share of the whole processor.
    pub cpu_percent: f64,
    pub memory_bytes: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Battery {
    /// 0-100.
    pub percent: Option<f64>,
    pub charging: bool,
    /// Only while running on the battery, when the OS can tell.
    pub minutes_left: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AudioState {
    /// 0-100.
    pub volume_percent: Option<f64>,
    pub muted: Option<bool>,
    /// The output device's name, e.g. "Speakers".
    pub device: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ActiveWindow {
    /// The app's name, e.g. "Visual Studio Code".
    pub app: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum MediaStatus {
    Playing,
    Paused,
    Stopped,
    /// No app is reporting media to the OS.
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MediaState {
    pub status: MediaStatus,
    pub title: Option<String>,
    pub artist: Option<String>,
    /// The app that is playing, e.g. "Spotify".
    pub app: Option<String>,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
}

impl MediaState {
    /// Nothing is playing.
    pub fn none() -> Self {
        Self {
            status: MediaStatus::None,
            title: None,
            artist: None,
            app: None,
            can_play_pause: false,
            can_next: false,
            can_previous: false,
        }
    }
}

/// One monitor resolution, in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DisplaySize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PrepareParams {
    /// At most [`crate::mode::MAX_PREPARE_SIZES`], each validated like an attach size.
    pub sizes: Vec<DisplaySize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AttachParams {
    pub width: u32,
    pub height: u32,
    pub refresh_hz: u32,
    /// OS scaling for the virtual monitor, e.g. 150 for 150%. `None` keeps the OS default.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_percent: Option<u32>,
}

/// One line from the helper.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Message {
    Result {
        id: u32,
        result: CallResult,
    },
    Error {
        /// `None` when the line could not be parsed far enough to read its id.
        id: Option<u32>,
        error: HelperError,
    },
    Event {
        event: HelperEvent,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum CallResult {
    Hello(HelloInfo),
    Displays {
        displays: Vec<DisplayInfo>,
    },
    Attached {
        display: DisplayInfo,
    },
    /// How many sizes had to be added to the OS's list. Zero means every size was already
    /// available and nothing was asked of the user.
    Prepared {
        added: u32,
    },
    Detached,
    SystemStats(SystemStats),
    Media(MediaState),
    MediaControlled,
    Disks {
        drives: Vec<DriveInfo>,
    },
    Processes {
        processes: Vec<ProcessLoad>,
    },
    /// `battery` is null on a PC without one.
    Power {
        battery: Option<Battery>,
    },
    Audio(AudioState),
    AudioControlled,
    ActiveWindow(ActiveWindow),
}

/// Pushed by the helper without a request, e.g. when the user unplugs or rearranges monitors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum HelperEvent {
    DisplaysChanged { displays: Vec<DisplayInfo> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HelloInfo {
    pub protocol_version: u32,
    pub helper_version: String,
    pub platform: Platform,
    pub backend: BackendInfo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Platform {
    Windows,
    Macos,
    Linux,
    Other,
}

impl Platform {
    pub const fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "linux") {
            Self::Linux
        } else {
            Self::Other
        }
    }
}

/// Which virtual-display strategy this machine uses and whether it is ready.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BackendInfo {
    /// Short identifier, e.g. `vdd`, `cg-virtual-display`, `mutter`.
    pub name: String,
    pub ready: bool,
    /// Why the backend is not ready, phrased so the desktop app can show it to the user.
    #[ts(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[allow(clippy::struct_excessive_bools)]
pub struct Capabilities {
    pub virtual_display: bool,
    pub resize: bool,
    pub scaling: bool,
    pub input_injection: bool,
    pub window_control: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DisplayInfo {
    /// Stable for the life of the display. On Windows this matches Electron's `display_id`.
    pub id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub refresh_hz: u32,
    pub scale_factor: f64,
    pub primary: bool,
    /// True for the monitor this helper created.
    pub virtual_display: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorCode {
    /// The line was not valid JSON or not a known request.
    Parse,
    InvalidParams,
    /// This OS or desktop environment has no implementation for the call (yet).
    Unsupported,
    /// The virtual display driver or compositor support is missing.
    BackendUnavailable,
    /// Needs elevation (Windows UAC) or an OS permission the user has not granted.
    PermissionDenied,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, thiserror::Error)]
#[error("{code:?}: {message}")]
#[ts(export)]
pub struct HelperError {
    pub code: ErrorCode,
    pub message: String,
}

impl HelperError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn unsupported(what: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unsupported, what)
    }

    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidParams, message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_unit_and_param_calls() {
        let hello: Request =
            serde_json::from_value(json!({"id": 1, "method": "helper.hello"})).unwrap();
        assert_eq!(
            hello,
            Request {
                id: 1,
                call: Call::Hello
            }
        );

        let attach: Request = serde_json::from_value(json!({
            "id": 2,
            "method": "display.attach",
            "params": {"width": 1440, "height": 1080, "refreshHz": 60}
        }))
        .unwrap();
        assert_eq!(
            attach.call,
            Call::Attach(AttachParams {
                width: 1440,
                height: 1080,
                refresh_hz: 60,
                scale_percent: None
            })
        );
    }

    #[test]
    fn parses_prepare_with_a_size_list() {
        let prepare: Request = serde_json::from_value(json!({
            "id": 4,
            "method": "display.prepare",
            "params": {"sizes": [
                {"width": 1440, "height": 1080},
                {"width": 1080, "height": 1440}
            ]}
        }))
        .unwrap();
        assert_eq!(
            prepare.call,
            Call::PrepareDisplays(PrepareParams {
                sizes: vec![
                    DisplaySize {
                        width: 1440,
                        height: 1080
                    },
                    DisplaySize {
                        width: 1080,
                        height: 1440
                    },
                ]
            })
        );
    }

    #[test]
    fn prepare_takes_numbers_only() {
        // No field of the schema is a string that could name a program or a path.
        for params in [
            json!({"sizes": [{"width": "1440", "height": 1080}]}),
            json!({"sizes": [{"width": 1440}]}),
            json!({"sizes": "1440x1080"}),
            json!({"sizes": [{"width": -1440, "height": 1080}]}),
            json!({}),
        ] {
            let result = serde_json::from_value::<Request>(
                json!({"id": 1, "method": "display.prepare", "params": params}),
            );
            assert!(result.is_err(), "{params}");
        }
    }

    #[test]
    fn parses_media_buttons_and_nothing_else() {
        let press: Request = serde_json::from_value(json!({
            "id": 4,
            "method": "media.control",
            "params": {"action": "play-pause"}
        }))
        .unwrap();
        assert_eq!(
            press.call,
            Call::MediaControl(MediaControlParams {
                action: MediaAction::PlayPause
            })
        );
        for action in ["shutdown", "volume-up", "PlayPause", ""] {
            let bad = serde_json::from_value::<Request>(json!({
                "id": 5,
                "method": "media.control",
                "params": {"action": action}
            }));
            assert!(bad.is_err(), "{action}");
        }
    }

    #[test]
    fn serializes_stats_and_media_results_flat() {
        let stats = CallResult::SystemStats(SystemStats {
            cpu_percent: Some(12.5),
            memory_used_bytes: Some(8.0e9),
            memory_total_bytes: Some(16.0e9),
            gpu_percent: None,
            network_received_per_second: Some(1000.0),
            network_sent_per_second: Some(10.0),
            ..SystemStats::default()
        });
        assert_eq!(
            serde_json::to_value(&stats).unwrap(),
            json!({
                "type": "systemStats",
                "cpuPercent": 12.5,
                "memoryUsedBytes": 8.0e9,
                "memoryTotalBytes": 16.0e9,
                "gpuPercent": null,
                "networkReceivedPerSecond": 1000.0,
                "networkSentPerSecond": 10.0
            })
        );
        assert_eq!(
            serde_json::to_value(CallResult::Media(MediaState::none())).unwrap()["status"],
            json!("none")
        );
    }

    #[test]
    fn parses_audio_control_and_nothing_else() {
        let mute: Request = serde_json::from_value(json!({
            "id": 6, "method": "audio.control", "params": {"action": "toggle-mute"}
        }))
        .unwrap();
        assert_eq!(
            mute.call,
            Call::AudioControl(AudioControlParams::ToggleMute)
        );
        let volume: Request = serde_json::from_value(json!({
            "id": 7, "method": "audio.control", "params": {"action": "set-volume", "percent": 40}
        }))
        .unwrap();
        assert_eq!(
            volume.call,
            Call::AudioControl(AudioControlParams::SetVolume { percent: 40.0 })
        );
        for params in [
            json!({"action": "set-volume"}),
            json!({"action": "set-volume", "percent": "40"}),
            json!({"action": "mute-everything"}),
        ] {
            let bad = serde_json::from_value::<Request>(
                json!({"id": 8, "method": "audio.control", "params": params}),
            );
            assert!(bad.is_err(), "{params}");
        }
    }

    #[test]
    fn serializes_the_new_readings() {
        let power = CallResult::Power {
            battery: Some(Battery {
                percent: Some(82.0),
                charging: false,
                minutes_left: Some(214.0),
            }),
        };
        assert_eq!(
            serde_json::to_value(&power).unwrap(),
            json!({"type": "power", "battery": {"percent": 82.0, "charging": false, "minutesLeft": 214.0}})
        );
        assert_eq!(
            serde_json::to_value(CallResult::Power { battery: None }).unwrap(),
            json!({"type": "power", "battery": null})
        );
        let window = CallResult::ActiveWindow(ActiveWindow {
            app: Some("Code".into()),
            title: None,
        });
        assert_eq!(
            serde_json::to_value(&window).unwrap(),
            json!({"type": "activeWindow", "app": "Code", "title": null})
        );
    }

    #[test]
    fn rejects_unknown_methods() {
        let err = serde_json::from_value::<Request>(
            json!({"id": 3, "method": "shell.exec", "params": "rm -rf /"}),
        );
        assert!(err.is_err());
    }

    #[test]
    fn serializes_messages_with_kind_tags() {
        let msg = Message::Result {
            id: 7,
            result: CallResult::Detached,
        };
        assert_eq!(
            serde_json::to_value(&msg).unwrap(),
            json!({"kind": "result", "id": 7, "result": {"type": "detached"}})
        );

        let prepared = Message::Result {
            id: 8,
            result: CallResult::Prepared { added: 2 },
        };
        assert_eq!(
            serde_json::to_value(&prepared).unwrap(),
            json!({"kind": "result", "id": 8, "result": {"type": "prepared", "added": 2}})
        );

        let err = Message::Error {
            id: None,
            error: HelperError::unsupported("nope"),
        };
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            json!({"kind": "error", "id": null, "error": {"code": "unsupported", "message": "nope"}})
        );
    }
}
