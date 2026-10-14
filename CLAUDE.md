# ShiftPane

Phone or tablet as a second monitor sized to the device, plus a live widget panel. Monorepo: pnpm + Turborepo for
TypeScript, a Cargo workspace for the native helper. See README.md for the layout and stack rationale.

## Commands

- `pnpm lint` (Biome, whole repo) / `pnpm format` to fix
- `pnpm typecheck`, `pnpm test`, `pnpm build` (Turborepo; includes `@shiftpane/native`, which runs cargo)
- One package: `pnpm --filter @shiftpane/layout test`; one Vitest file: `pnpm --filter @shiftpane/layout exec vitest run src/split.test.ts`
- Rust: `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`
- Cross-check native code for other OSes: `cargo clippy --workspace --all-targets --target x86_64-pc-windows-msvc` (or `aarch64-apple-darwin`) after `rustup target add ...`
- Package an unpacked desktop app: `pnpm turbo run package --filter=@shiftpane/desktop -- --dir`

## Conventions

- Internal TS packages export source (`"exports": "./src/index.ts"`); there is no build step for them. Use `.ts`
  extensions on relative imports so scripts run directly under Node's type stripping.
- Shared dependency versions live in the `catalog:` in `pnpm-workspace.yaml`. Add new shared deps there.
- Desktop dependencies are all `devDependencies`: electron-vite bundles them and the packaged app ships no `node_modules`.
- Every message crossing a process boundary is schema-validated: zod in `packages/protocol` (PC <-> phone), serde in
  `native/crates/core/src/protocol.rs` (desktop <-> helper). Never add a message that carries a raw command to run.
- The helper protocol's Rust types are the source of truth. After changing them run `cargo test -p shiftpane-core`
  to regenerate `packages/helper-client/src/bindings/` and commit the result (CI diffs it). Re-export new types in
  `packages/helper-client/src/protocol.ts`.
- After changing `packages/widget-sdk/src/manifest.ts`, run `pnpm --filter @shiftpane/widget-sdk schema` (a test
  fails if the committed JSON Schema drifts).
- OS-specific Rust goes behind `cfg` in `native/crates/{windows,macos,linux}`; every crate must still compile on every OS.
- Electron windows keep `contextIsolation`, `sandbox` and no `nodeIntegration`; the renderer gets only `window.shiftpane`
  (typed in `apps/desktop/src/preload/api.ts`).

## Gotchas

- Vite is pinned to 7 because electron-vite 5 does not support Vite 8.
- TypeScript 7 is the native compiler: there is no `tsserver.js`, so editor tooling uses the TS native preview.
- Set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for installs that never launch Electron (CI lint jobs do).
- Cloud sessions behind the agent proxy need `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` for Electron and
  electron-builder downloads; `.claude/hooks/session-start.sh` sets it.

## Plan

The hackathon plan (display mode first, then widgets, split view, AI widget generator, Easter egg, remote control) drives
priorities. The website (docs + hosted phone demo) is deliberately not started yet.
