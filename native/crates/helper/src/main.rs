//! `shiftpane-helper`: spawned by the desktop app, speaks JSON lines on stdin/stdout.
//!
//! stdout carries protocol messages only; logs go to stderr (`RUST_LOG=debug` for more).
//! Closing stdin shuts the helper down and removes the virtual monitor.

use std::io::{self, BufWriter, IsTerminal};

use shiftpane_core::DisplayBackend;
use tracing_subscriber::EnvFilter;

fn main() -> anyhow::Result<()> {
    let arg = std::env::args().nth(1);
    match arg.as_deref() {
        None | Some("serve") => serve(),
        Some("--version" | "-V") => {
            println!(
                "shiftpane-helper {} (protocol {})",
                env!("CARGO_PKG_VERSION"),
                shiftpane_core::PROTOCOL_VERSION
            );
            Ok(())
        }
        Some("info") => {
            let backend = backend();
            println!("{}", serde_json_pretty(&backend.info())?);
            Ok(())
        }
        // Internal: the elevated half of a Windows attach. Takes numbers only.
        Some("apply-modes") => apply_modes(),
        Some(other) => anyhow::bail!(
            "unknown argument {other:?}; usage: shiftpane-helper [serve|info|--version]"
        ),
    }
}

#[cfg(windows)]
fn apply_modes() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(2).collect();
    std::process::exit(shiftpane_windows::elevated::run(&args))
}

#[cfg(not(windows))]
fn apply_modes() -> anyhow::Result<()> {
    anyhow::bail!("apply-modes is only available on Windows")
}

fn serve() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(io::stderr)
        .with_ansi(io::stderr().is_terminal())
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let mut backend = backend();
    tracing::info!(backend = %backend.info().name, "helper ready");
    shiftpane_core::server::serve(
        io::stdin().lock(),
        BufWriter::new(io::stdout().lock()),
        backend.as_mut(),
    )?;
    Ok(())
}

fn serde_json_pretty(value: &impl serde::Serialize) -> anyhow::Result<String> {
    Ok(serde_json::to_string_pretty(value)?)
}

#[cfg(windows)]
fn backend() -> Box<dyn DisplayBackend> {
    Box::new(shiftpane_windows::VddBackend::default())
}

#[cfg(target_os = "macos")]
fn backend() -> Box<dyn DisplayBackend> {
    Box::new(shiftpane_macos::VirtualDisplayBackend)
}

#[cfg(target_os = "linux")]
fn backend() -> Box<dyn DisplayBackend> {
    Box::new(shiftpane_linux::CompositorBackend::from_env())
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn backend() -> Box<dyn DisplayBackend> {
    Box::new(shiftpane_core::UnsupportedBackend::new(
        "this operating system has no ShiftPane backend",
    ))
}
