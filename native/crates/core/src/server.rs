//! The helper's request loop: read a JSON line, dispatch it, write a JSON line.

use std::io::{self, BufRead, Write};

use crate::backend::DisplayBackend;
use crate::mode::Mode;
use crate::protocol::{
    Call, CallResult, ErrorCode, HelloInfo, HelperError, Message, PROTOCOL_VERSION, Platform,
    Request,
};

/// Requests longer than this are rejected without being parsed.
const MAX_LINE_BYTES: usize = 64 * 1024;

/// Serves requests until `input` reaches end of file, which is how the desktop app asks the
/// helper to exit. The virtual monitor is detached on the way out.
pub fn serve<R: BufRead, W: Write>(
    input: R,
    mut output: W,
    backend: &mut dyn DisplayBackend,
) -> io::Result<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = handle_line(&line, backend);
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
        Call::Detach => backend.detach().map(|()| CallResult::Detached),
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
        detach_calls: u32,
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
