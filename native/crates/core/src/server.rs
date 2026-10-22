//! The helper's request loop: read a JSON line, dispatch it, write a JSON line.

use std::io::{self, BufRead, Write};

use crate::backend::DisplayBackend;
use crate::mode::{self, Mode};
use crate::protocol::{
    AudioControlParams, Call, CallResult, ErrorCode, HelloInfo, HelperError, Message,
    PROTOCOL_VERSION, Platform, Request,
};

/// Requests longer than this are rejected without being parsed.
const MAX_LINE_BYTES: usize = 64 * 1024;

/// Some writers put a UTF-8 byte order mark before the first line (.NET's `Process` does when
/// it opens a redirected stdin); it is not part of the JSON and would fail to parse.
const BYTE_ORDER_MARK: char = '\u{feff}';

/// Serves requests until `input` reaches end of file, which is how the desktop app asks the
/// helper to exit. The virtual monitor is detached on the way out.
pub fn serve<R: BufRead, W: Write>(
    input: R,
    mut output: W,
    backend: &mut dyn DisplayBackend,
) -> io::Result<()> {
    for line in input.lines() {
        let line = line?;
        let line = line.strip_prefix(BYTE_ORDER_MARK).unwrap_or(&line);
        if line.trim().is_empty() {
            continue;
        }
        let reply = handle_line(line, backend);
        serde_json::to_writer(&mut output, &reply)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    if let Err(err) = backend.detach() {
        tracing::warn!(%err, "detach on shutdown failed");
    }
    Ok(())
}

/// Turns one input line into exactly one reply.
pub fn handle_line(line: &str, backend: &mut dyn DisplayBackend) -> Message {
    if line.len() > MAX_LINE_BYTES {
        return Message::Error {
            id: None,
            error: HelperError::new(ErrorCode::Parse, "request too large"),
        };
    }
    let request: Request = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(err) => {
            // Recover the id when the envelope is fine but the method or params are not,
            // so the desktop app can fail the right pending promise.
            let id = serde_json::from_str::<serde_json::Value>(line)
                .ok()
                .and_then(|v| v.get("id").and_then(serde_json::Value::as_u64))
                .and_then(|id| u32::try_from(id).ok());
            return Message::Error {
                id,
                error: HelperError::new(ErrorCode::Parse, err.to_string()),
            };
        }
    };
    let id = request.id;
    tracing::debug!(id, call = ?request.call, "request");
    match dispatch(&request.call, backend) {
        Ok(result) => Message::Result { id, result },
        Err(error) => Message::Error {
            id: Some(id),
            error,
        },
    }
}

fn dispatch(call: &Call, backend: &mut dyn DisplayBackend) -> Result<CallResult, HelperError> {
    match call {
        Call::Hello => Ok(CallResult::Hello(HelloInfo {
            protocol_version: PROTOCOL_VERSION,
            helper_version: env!("CARGO_PKG_VERSION").to_owned(),
            platform: Platform::current(),
            backend: backend.info(),
        })),
        Call::ListDisplays => backend
            .list_displays()
            .map(|displays| CallResult::Displays { displays }),
        Call::Attach(params) => {
            let mode = Mode::try_from(*params)?;
            backend
                .attach(mode)
                .map(|display| CallResult::Attached { display })
        }
        Call::PrepareDisplays(params) => {
            let sizes = mode::prepare_sizes(params)?;
            backend
                .prepare(&sizes)
                .map(|added| CallResult::Prepared { added })
        }
        Call::Detach => backend.detach().map(|()| CallResult::Detached),
        Call::SystemStats => backend.system_stats().map(CallResult::SystemStats),
        Call::MediaState => backend.media_state().map(CallResult::Media),
        Call::MediaControl(params) => backend
            .media_control(params.action)
            .map(|()| CallResult::MediaControlled),
        Call::Disks => backend.disks().map(|drives| CallResult::Disks { drives }),
        Call::Processes => backend
            .processes()
            .map(|processes| CallResult::Processes { processes }),
        Call::Power => backend.power().map(|battery| CallResult::Power { battery }),
        Call::AudioState => backend.audio_state().map(CallResult::Audio),
        Call::AudioControl(params) => {
            if let AudioControlParams::SetVolume { percent } = params
                && !(0.0..=100.0).contains(percent)
            {
                return Err(HelperError::invalid_params(
                    "the volume has to be between 0 and 100",
                ));
            }
            backend
                .audio_control(*params)
                .map(|()| CallResult::AudioControlled)
        }
        Call::ActiveWindow => backend.active_window().map(CallResult::ActiveWindow),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::UnsupportedBackend;
    use crate::protocol::{BackendInfo, Capabilities, DisplayInfo};
    use serde_json::{Value, json};

    /// Records calls so tests can assert what reached the backend.
    #[derive(Default)]
    struct FakeBackend {
        attached: Option<Mode>,
        prepared: Vec<Vec<(u32, u32)>>,
        detach_calls: u32,
        audio: Vec<AudioControlParams>,
    }

    impl DisplayBackend for FakeBackend {
        fn info(&self) -> BackendInfo {
            BackendInfo {
                name: "fake".into(),
                ready: true,
                reason: None,
                capabilities: Capabilities::default(),
            }
        }
        fn list_displays(&self) -> Result<Vec<DisplayInfo>, HelperError> {
            Ok(vec![])
        }
        fn prepare(&mut self, sizes: &[(u32, u32)]) -> Result<u32, HelperError> {
            self.prepared.push(sizes.to_vec());
            Ok(u32::try_from(sizes.len()).unwrap())
        }
        fn attach(&mut self, mode: Mode) -> Result<DisplayInfo, HelperError> {
            self.attached = Some(mode);
            Ok(DisplayInfo {
                id: "virtual-1".into(),
                name: "ShiftPane".into(),
                x: 1920,
                y: 0,
                width: mode.width,
                height: mode.height,
                refresh_hz: mode.refresh_hz,
                scale_factor: 1.0,
                primary: false,
                virtual_display: true,
            })
        }
        fn audio_control(&mut self, params: AudioControlParams) -> Result<(), HelperError> {
            self.audio.push(params);
            Ok(())
        }
        fn detach(&mut self) -> Result<(), HelperError> {
            self.attached = None;
            self.detach_calls += 1;
            Ok(())
        }
    }

    fn run(input: &str, backend: &mut dyn DisplayBackend) -> Vec<Value> {
        let mut out = Vec::new();
        serve(input.as_bytes(), &mut out, backend).unwrap();
        String::from_utf8(out)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn answers_each_line_and_detaches_on_eof() {
        let mut backend = FakeBackend::default();
        let replies = run(
            concat!(
                r#"{"id":1,"method":"helper.hello"}"#,
                "\n\n",
                r#"{"id":2,"method":"display.attach","params":{"width":1440,"height":1080,"refreshHz":60}}"#,
                "\n"
            ),
            &mut backend,
        );
        assert_eq!(replies.len(), 2);
        assert_eq!(
            replies[0]["result"]["protocolVersion"],
            json!(PROTOCOL_VERSION)
        );
        assert_eq!(replies[1]["result"]["display"]["width"], json!(1440));
        assert_eq!(backend.detach_calls, 1, "EOF must detach");
        assert!(backend.attached.is_none());
    }

    #[test]
    fn invalid_mode_never_reaches_the_backend() {
        let mut backend = FakeBackend::default();
        let reply = handle_line(
            r#"{"id":5,"method":"display.attach","params":{"width":1441,"height":1080,"refreshHz":60}}"#,
            &mut backend,
        );
        assert!(
            matches!(reply, Message::Error { id: Some(5), ref error } if error.code == ErrorCode::InvalidParams)
        );
        assert!(backend.attached.is_none());
    }

    #[test]
    fn prepare_reaches_the_backend_once_with_validated_unique_sizes() {
        let mut backend = FakeBackend::default();
        let reply = handle_line(
            r#"{"id":6,"method":"display.prepare","params":{"sizes":[{"width":1440,"height":1080},{"width":1080,"height":1440},{"width":1440,"height":1080}]}}"#,
            &mut backend,
        );
        assert_eq!(
            reply,
            Message::Result {
                id: 6,
                result: CallResult::Prepared { added: 2 }
            }
        );
        assert_eq!(backend.prepared, vec![vec![(1440, 1080), (1080, 1440)]]);
    }

    #[test]
    fn invalid_prepare_never_reaches_the_backend() {
        let mut backend = FakeBackend::default();
        for line in [
            r#"{"id":7,"method":"display.prepare","params":{"sizes":[]}}"#,
            r#"{"id":7,"method":"display.prepare","params":{"sizes":[{"width":1441,"height":1080}]}}"#,
        ] {
            let reply = handle_line(line, &mut backend);
            assert!(
                matches!(reply, Message::Error { id: Some(7), ref error } if error.code == ErrorCode::InvalidParams),
                "{line}"
            );
        }
        assert_eq!(backend.prepared.len(), 0, "nothing may reach the backend");
    }

    #[test]
    fn audio_control_takes_a_volume_only_within_range() {
        let mut backend = FakeBackend::default();
        let replies = run(
            concat!(
                "{\"id\":1,\"method\":\"audio.control\",\"params\":{\"action\":\"set-volume\",\"percent\":140}}
",
                "{\"id\":2,\"method\":\"audio.control\",\"params\":{\"action\":\"set-volume\",\"percent\":40}}
",
                "{\"id\":3,\"method\":\"audio.control\",\"params\":{\"action\":\"toggle-mute\"}}
",
            ),
            &mut backend,
        );
        assert_eq!(replies[0]["error"]["code"], json!("invalidParams"));
        assert_eq!(replies[1]["result"]["type"], json!("audioControlled"));
        assert_eq!(
            backend.audio,
            vec![
                AudioControlParams::SetVolume { percent: 40.0 },
                AudioControlParams::ToggleMute
            ]
        );
    }

    #[test]
    fn readings_an_os_lacks_are_unsupported() {
        let mut backend = UnsupportedBackend::new("no virtual display support on this OS");
        let replies = run(
            "{\"id\":1,\"method\":\"power.state\"}
{\"id\":2,\"method\":\"window.active\"}
",
            &mut backend,
        );
        assert_eq!(replies[0]["error"]["code"], json!("unsupported"));
        assert_eq!(replies[1]["error"]["code"], json!("unsupported"));
    }

    #[test]
    fn unsupported_backend_refuses_prepare() {
        let mut backend = UnsupportedBackend::new("no virtual display support on this OS");
        let replies = run(
            "{\"id\":1,\"method\":\"display.prepare\",\"params\":{\"sizes\":[{\"width\":1440,\"height\":1080}]}}\n",
            &mut backend,
        );
        assert_eq!(replies[0]["error"]["code"], json!("unsupported"));
    }

    #[test]
    fn tolerates_a_leading_byte_order_mark() {
        // .NET's Process writes EF BB BF before the first line of a redirected stdin.
        let mut backend = FakeBackend::default();
        let replies = run(
            "\u{feff}{\"id\":1,\"method\":\"helper.hello\"}\n{\"id\":2,\"method\":\"helper.hello\"}\n",
            &mut backend,
        );
        assert_eq!(replies.len(), 2);
        assert_eq!(replies[0]["kind"], json!("result"));
        assert_eq!(replies[0]["id"], json!(1));
        // A BOM alone on its line is blank, not a parse error.
        let replies = run(
            "\u{feff}\n{\"id\":3,\"method\":\"helper.hello\"}\n",
            &mut backend,
        );
        assert_eq!(replies.len(), 1);
    }

    #[test]
    fn unknown_method_keeps_the_id() {
        let mut backend = FakeBackend::default();
        let reply = handle_line(
            r#"{"id":9,"method":"shell.exec","params":"whoami"}"#,
            &mut backend,
        );
        assert!(
            matches!(reply, Message::Error { id: Some(9), ref error } if error.code == ErrorCode::Parse)
        );
    }

    #[test]
    fn garbage_and_oversized_lines_are_errors_not_crashes() {
        let mut backend = FakeBackend::default();
        assert!(matches!(
            handle_line("not json", &mut backend),
            Message::Error { id: None, .. }
        ));
        let huge = format!(
            r#"{{"id":1,"method":"helper.hello","pad":"{}"}}"#,
            "x".repeat(MAX_LINE_BYTES)
        );
        assert!(matches!(
            handle_line(&huge, &mut backend),
            Message::Error { id: None, .. }
        ));
    }

    #[test]
    fn unsupported_backend_still_says_hello() {
        let mut backend = UnsupportedBackend::new("no virtual display support on this OS");
        let replies = run("{\"id\":1,\"method\":\"helper.hello\"}\n", &mut backend);
        assert_eq!(replies[0]["result"]["backend"]["ready"], json!(false));
    }
}
