/**
 * The helper protocol version this build of the desktop app speaks. It must equal
 * `PROTOCOL_VERSION` in `native/crates/core/src/protocol.rs`; `version.test.ts` fails when the
 * two drift. The desktop app refuses a helper that answers `helper.hello` with another number,
 * which is what a stale `target/` build looks like after the protocol changed.
 */
export const HELPER_PROTOCOL_VERSION = 3
