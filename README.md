# ShiftPane

Scan a QR code and your phone becomes a monitor shaped exactly like it, with your live stats beside it.
No cable, no dummy plug, no app store.

- **Display mode.** The phone becomes a real extra monitor. The OS sees a new display sized to the phone, and you drag windows onto it.
- **Dashboard mode.** The phone shows widgets: PC telemetry, GitHub stats, Claude Code usage, and anything the community builds.
- **Split view.** Both at once. The split you pick is the resolution of the second monitor.
- **Widget gallery.** Every widget is a small folder anyone can write and submit by pull request; a local open-weight model can generate new ones from a sentence.

> **Status:** early development. The monorepo, shared contracts, app shells, native helper skeleton and CI are in place; display mode, widgets and pairing are being built now.

## Repository layout

```text
apps/
  desktop/            Electron app: pairing, HTTPS + WebSocket server, capture, widget collectors
  phone/              PWA served by the desktop app: stream player, split view, widget panel, gallery
packages/
  protocol/           PC <-> phone WebSocket messages and pairing tokens (zod)
  layout/             Split-view math: phone size + split + pixel ratio -> monitor resolution
  widget-sdk/         Widget manifest schema (+ generated JSON Schema) and defineCollector
  helper-client/      Typed client for the native helper; types generated from Rust
  ui/                 Tailwind v4 design tokens shared by both apps
native/
  crates/core/        Helper wire protocol, mode validation, DisplayBackend trait, request loop
  crates/windows/     Virtual Display Driver (IddCx) + Win32 display control
  crates/macos/       CGVirtualDisplay: in-process virtual monitor, no driver
  crates/linux/       Mutter / KWin / wlroots / X11 virtual outputs
  crates/helper/      shiftpane-helper binary
.claude/              Project skills, plugins and the cloud-session setup hook
.github/workflows/    CI on every push; installers on version tags
```

Planned: `widgets/` (built-in and community widgets plus `registry.json`) and `apps/web` (documentation site and hosted phone demo).

## How it fits together

```text
 phone (PWA) ──HTTPS / WebSocket (zod-validated)──▶ desktop app (Electron) ──stdin/stdout JSON──▶ shiftpane-helper (Rust)
      ▲                                                  │                                              │
      └────────────── WebRTC video (DTLS-SRTP) ──────────┘ captures only the virtual monitor            └─ creates and sizes it
```

The desktop app is the only process that talks to the phone, and the native helper is the only process that talks to OS display APIs.
Secrets and system access stay on the PC; the phone only ever receives video and finished widget data.

## Platform support

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Virtual monitor | [Virtual Display Driver](https://github.com/VirtualDrivers/Virtual-Display-Driver) (user installs once via winget) | `CGVirtualDisplay`, built in (macOS 11+) | Compositor-specific: GNOME, KDE, wlroots, X11 |
| Widgets and dashboard | ✓ | ✓ | ✓ |
| Installer | NSIS `.exe` | `.dmg` | AppImage, `.deb` |

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Monorepo | pnpm workspaces + catalogs, Turborepo, Cargo workspace | One install, one version of each dependency, cached task graph across TS and Rust |
| Desktop | Electron 44 + electron-vite 5 + React 19 (React Compiler) | Per-display capture, hardware-encoded WebRTC and Node in one runtime on all three OSes |
| Phone | Vite + React 19 + Tailwind v4 + vite-plugin-pwa | One codebase for iPhone and Android, installable, no app store |
| Contracts | zod 4 (PC <-> phone), ts-rs (Rust -> TS for the helper) | Every boundary is typed on both sides and validated at runtime |
| Native helper | Rust 2024 edition, one crate per OS behind a shared trait | Direct OS APIs, one long-running process that keeps the virtual monitor alive, memory-safe |
| Lint and format | Biome 2, rustfmt, clippy (pedantic) | Fast, single tool per language |
| Types | TypeScript 7 (native compiler) | Strict mode, `noUncheckedIndexedAccess`; typechecks the whole repo in seconds |
| Tests | Vitest 5 + fast-check (property tests), `cargo test` | Core logic covered by example and property tests |
| Packaging | electron-builder 26, GitHub Actions | Installers for all three OSes from one tag |

Vite is held at 7 because electron-vite 5 does not support Vite 8 yet; move both when electron-vite 6 is stable.

## Getting started

Requirements: Node 22.12+, pnpm 10 (`corepack enable`), Rust stable (picked up from `rust-toolchain.toml`).

```sh
pnpm install
pnpm dev:phone      # phone PWA dev server on http://localhost:5173 (no pairing yet)
pnpm dev:desktop    # Electron app with hot reload
```

| Command | What it does |
| --- | --- |
| `pnpm lint` | Biome over the whole repo |
| `pnpm format` | Biome with fixes applied |
| `pnpm typecheck` | `tsc` per package, `cargo check` for the native workspace |
| `pnpm test` | Vitest per package, `cargo test` (also regenerates the helper's TS bindings) |
| `pnpm build` | Production builds of every package |
| `pnpm package` | Phone build + release helper + installer for the current OS in `apps/desktop/release/` |
| `cargo run -p shiftpane-helper -- info` | Print this machine's virtual-display readiness |

## Working with Claude Code

`.claude/skills/` vendors skills for this stack (Electron, React 19, Tailwind 4, zod 4, Playwright, Rust, TDD, debugging);
see [.claude/skills/README.md](.claude/skills/README.md) for sources and licenses. Cloud sessions run `.claude/hooks/session-start.sh` to install dependencies.

## License

[MIT](LICENSE). Third-party projects are used as dependencies or references only; Virtual Display Driver is installed by the user and never bundled.
