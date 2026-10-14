//! Platform-independent half of the ShiftPane native helper.
//!
//! The desktop app spawns `shiftpane-helper` and talks to it over stdin/stdout, one JSON
//! object per line. This crate owns that wire format ([`protocol`]), the validated display
//! mode type ([`mode`]), the trait each OS implements ([`backend`]) and the request loop
//! ([`server`]). The per-OS crates only implement [`backend::DisplayBackend`].

pub mod backend;
pub mod mode;
pub mod protocol;
pub mod server;

pub use backend::{DisplayBackend, UnsupportedBackend};
pub use mode::Mode;
pub use protocol::{HelperError, PROTOCOL_VERSION};
