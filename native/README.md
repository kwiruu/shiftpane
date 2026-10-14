# Native helper

`shiftpane-helper` is the only part of ShiftPane that touches OS display APIs. The desktop
app spawns it and talks to it over stdin/stdout, one JSON object per line. Closing stdin
shuts it down and removes the virtual monitor.

| Crate | Path | Job |
| --- | --- | --- |
| `shiftpane-core` | `crates/core` | Wire protocol, mode validation, the `DisplayBackend` trait, the request loop. Platform-independent and fully unit-tested. |
| `shiftpane-windows` | `crates/windows` | Drives [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver) (IddCx) and Win32 display settings. |
| `shiftpane-macos` | `crates/macos` | `CGVirtualDisplay`: in-process virtual monitor, no driver needed. |
| `shiftpane-linux` | `crates/linux` | Picks a compositor strategy: Mutter, KWin, wlroots or X11. |
| `shiftpane-helper` | `crates/helper` | The binary. Selects the backend for the OS it was compiled for. |

Every crate compiles on every OS (platform-only code sits behind `cfg`), so
`cargo clippy --workspace` and the core tests run on any machine.

## Status

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Readiness check (`helper.hello`) | VDD installed? | `CGVirtualDisplay` present? | Session/compositor detected |
| `display.list` / `attach` / `detach` | not yet | not yet | not yet |

## Protocol

```jsonc
// desktop -> helper
{"id": 1, "method": "helper.hello"}
{"id": 2, "method": "display.attach", "params": {"width": 1440, "height": 1080, "refreshHz": 60, "scalePercent": 150}}
// helper -> desktop
{"kind": "result", "id": 2, "result": {"type": "attached", "display": {"id": "...", "width": 1440, ...}}}
{"kind": "error", "id": 2, "error": {"code": "backendUnavailable", "message": "..."}}
{"kind": "event", "event": {"type": "displaysChanged", "displays": [...]}}
```

The Rust types in `crates/core/src/protocol.rs` are the source of truth. `cargo test` regenerates
the TypeScript copies in `packages/helper-client/src/bindings` (CI fails if they drift).

## Commands

```sh
pnpm --filter @shiftpane/native test     # cargo test, also refreshes TS bindings
pnpm --filter @shiftpane/native lint     # rustfmt --check + clippy -D warnings
pnpm --filter @shiftpane/native build    # release binary in target/release/
cargo run -p shiftpane-helper -- info    # print this machine's backend readiness
```
