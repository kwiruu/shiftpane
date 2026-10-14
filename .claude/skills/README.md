# Project skills

Claude Code loads every folder here as a project skill for anyone working in this repo.
They are vendored (copied in) so every clone and every cloud session gets the same set.
Only MIT and Apache-2.0 skills are included, so nothing here conflicts with the repo's MIT license.

| Skill | Use it for | Source | License |
| --- | --- | --- | --- |
| `electron` | Main/preload/renderer split, secure IPC, packaging | [Gentleman-Programming/Gentleman-Skills](https://github.com/Gentleman-Programming/Gentleman-Skills/tree/main/community/electron) @ `c8036a3` | MIT |
| `react-19` | React 19 and React Compiler idioms (desktop UI, phone PWA) | [Gentleman-Skills](https://github.com/Gentleman-Programming/Gentleman-Skills/tree/main/curated/react-19) @ `c8036a3` | MIT |
| `react-best-practices` | Render and bundle performance rules (the `server-*` rules are Next.js-only, ignore them) | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) @ `063bee9` | MIT |
| `tailwind-4` | Tailwind v4 CSS-first config (`@theme`, no `tailwind.config.js`) | [Gentleman-Skills](https://github.com/Gentleman-Programming/Gentleman-Skills/tree/main/curated/tailwind-4) @ `c8036a3` | MIT |
| `zod-4` | Zod 4 APIs used by `@shiftpane/protocol` and the widget manifest | [Gentleman-Skills](https://github.com/Gentleman-Programming/Gentleman-Skills/tree/main/curated/zod-4) @ `c8036a3` | MIT |
| `playwright` | Phone UI end-to-end tests (`@playwright/test`) | [Gentleman-Skills](https://github.com/Gentleman-Programming/Gentleman-Skills/tree/main/curated/playwright) @ `c8036a3` | MIT |
| `frontend-design` | Visual direction for the phone PWA, desktop window and the future website | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) @ `dbd4588` | Apache-2.0 |
| `rust-best-practices` | The native helper crates under `native/` | [apollographql/skills](https://github.com/apollographql/skills/tree/main/skills/rust-best-practices) @ `aafc894` | MIT |
| `test-driven-development` | Core logic: protocol, split math, pairing, manifest validation | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/test-driven-development) @ `bb92a77` | MIT |
| `systematic-debugging` | Driver, capture and WebRTC failures that need root-causing, not guessing | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/systematic-debugging) @ `bb92a77` | MIT |
| `verification-before-completion` | Run the checks before claiming something works | [obra/superpowers](https://github.com/obra/superpowers/tree/main/skills/verification-before-completion) @ `bb92a77` | MIT |

Local changes from upstream: the `superpowers:` prefix was dropped from cross-references between the three
obra/superpowers skills, and the skill-authoring test transcripts were removed from `systematic-debugging`.

## Plugins enabled for this repo

`.claude/settings.json` enables two language-server plugins from Anthropic's official marketplace
(`anthropics/claude-plugins-official`), which give Claude go-to-definition and live type errors:

- `typescript-lsp` needs `typescript-language-server` on your PATH (`npm i -g typescript-language-server typescript`).
- `rust-analyzer-lsp` needs `rust-analyzer` (`rustup component add rust-analyzer`).

## Considered and left out

- Trail of Bits skills (`property-based-testing`, `sharp-edges`, `rust-review`): excellent, but licensed
  CC BY-SA 4.0. Install them per user instead of vendoring:
  `/plugin marketplace add trailofbits/skills`.
- `security-guidance` (official marketplace): runs an LLM review on every stop. Worth enabling for the
  security pass before submission, not during day-to-day building.
- `webapp-testing` (anthropics/skills): drives Playwright from Python; this repo tests with `@playwright/test`.
