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
- Widget packages (the marketplace's format) are defined in `packages/widget-sdk` and drawn by `ViewWidget` in
  `packages/board` from the same parts as the built-in widgets; give a new view node the built-in look by reusing
  `parts.tsx`. Collectors run in `packages/widget-runtime` (QuickJS) from the desktop main process
  (`main/widgets/`), and their only way out is the guarded fetch in `packages/widget-runtime/src/fetch.ts`.
- The marketplace site (the `shiftpane-market` repo) draws widgets with this repo's code: its `pnpm sync:shiftpane`
  copies `widget-sdk`, `protocol`, `layout`, `board` and `ui`'s icons into its `vendor/shiftpane`. After changing
  those, re-sync there so the gallery matches the phone.
- OS-specific Rust goes behind `cfg` in `native/crates/{windows,macos,linux}`; every crate must still compile on every OS.
- Electron windows keep `contextIsolation`, `sandbox` and no `nodeIntegration`; the renderer gets only `window.shiftpane`
  (typed in `apps/desktop/src/preload/api.ts`).
- The main window is frameless on Windows and Linux (macOS keeps its traffic lights) and draws its own buttons. The
  title bar, page heading and logo are `-webkit-app-region: drag`; anything clickable inside them needs `no-drag`.
- The look lives in `packages/ui`: graphite tokens and the `hatched`/`raised`/`lifted`/`section-label` utilities in
  `theme.css`, and every icon via `<Icon>` from `@shiftpane/ui/icons` (Solar, Bold Duotone). Don't hand-draw icons:
  name a Solar one in `packages/ui/scripts/icons.ts` and run `pnpm --filter @shiftpane/ui icons`. Desktop pages are
  built from `Card`, `Button`, `Chip` and `Select` in `renderer/src/shell/parts.tsx`.

## Gotchas

- Vite is pinned to 7 because electron-vite 5 does not support Vite 8.
- TypeScript 7 is the native compiler: there is no `tsserver.js`, so editor tooling uses the TS native preview.
- Bundling `ws` into the Electron main process needs `WS_NO_BUFFER_UTIL`/`WS_NO_UTF_8_VALIDATE` defined (see
  `apps/desktop/electron.vite.config.ts`); without them every WebSocket frame over 32 bytes silently kills the
  connection. Unit tests run unbundled `ws` and will not catch this, so test pairing against the built app.
- The desktop app serves the phone app from `apps/phone/dist` in dev; rebuild the phone app to see phone changes there.
- The phone's Vite dev server runs in demo mode (sample data, no PC), so the phone UI can be designed in a desktop
  browser. The phone only shows the widget board; it is laid out in the desktop window's Phone layout view
  (`renderer/src/layout/`), and the PC keeps it (`main/board/`). The widgets and table rendering shared by both live
  in `packages/board`; apps import `@shiftpane/board/board.css` after Tailwind, which `@source`s the package.
- Set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` for installs that never launch Electron (CI lint jobs do).
- QuickJS's own memory limit does nothing in the WebAssembly build (it can't measure allocations), so the widget
  sandbox caps its `WebAssembly.Memory` instead (`packages/widget-runtime/src/run.ts`). Run collectors one at a time.
- Streaming the virtual monitor: the main process arms the one `desktopCapturer` source (`main/stream/gate.ts`) and the
  window takes it with `getDisplayMedia`; the session grants media permission only for that request. A source's
  `display_id` is empty until `screen.getAllDisplays()` has run, and the helper's GDI device name is not Electron's
  `Display.id`, so displays are joined on physical bounds (`main/stream/match.ts`). The first `RTCPeerConnection` in a
  page costs 1-2 s, hence the warm-up connections on both sides.
- Cloud sessions behind the agent proxy need `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` for Electron and
  electron-builder downloads; `.claude/hooks/session-start.sh` sets it.

## Plan

The hackathon plan (display mode first, then widgets, split view, AI widget generator, Easter egg, remote control) drives
priorities. The website (docs + hosted phone demo) is deliberately not started yet.
