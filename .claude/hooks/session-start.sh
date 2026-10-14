#!/bin/bash
# Installs dependencies at the start of a Claude Code cloud session so lint, typecheck and
# tests work immediately. Does nothing on local machines.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Node tools that download over HTTPS (Electron, electron-builder) need the sandbox proxy's CA.
if [ -f /root/.ccr/ca-bundle.crt ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt' >> "$CLAUDE_ENV_FILE"
fi
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export TURBO_TELEMETRY_DISABLED=1' >> "$CLAUDE_ENV_FILE"
fi

# JavaScript workspace. The Electron binary is skipped: cloud sessions lint, typecheck,
# test and build, but rarely launch the app (run `node apps/desktop/node_modules/electron/install.js` if needed).
corepack enable >/dev/null 2>&1 || true
ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --prefer-offline

# Rust workspace: toolchain from rust-toolchain.toml, then crates.
rustup toolchain install >/dev/null
cargo fetch --locked

# Language servers for the typescript-lsp and rust-analyzer-lsp plugins in .claude/settings.json.
# Optional: a failure here only disables code intelligence, so it never fails the session.
if ! command -v typescript-language-server >/dev/null 2>&1; then
  npm install -g typescript-language-server typescript@6 >/dev/null 2>&1 || echo "warn: typescript-language-server not installed" >&2
fi
rustup component add rust-analyzer >/dev/null 2>&1 || echo "warn: rust-analyzer not installed" >&2
