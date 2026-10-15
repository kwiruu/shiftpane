//! Messages exchanged between the desktop app and the helper.
//!
//! Every type here derives [`TS`], and `cargo test` writes the matching TypeScript to
//! `packages/helper-client/src/bindings`, so both ends compile against one definition.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Bumped on any breaking change to the messages below, and when the desktop app starts
/// relying on a call an older helper lacks (2: `display.prepare`). The desktop app compares
/// it with `HELPER_PROTOCOL_VERSION` in `packages/helper-client`.
pub const PROTOCOL_VERSION: u32 = 2;

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
