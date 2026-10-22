# ShiftPane web: docs and widget marketplace

One website for ShiftPane: the documentation, and a marketplace where people publish widgets and everyone else
installs them from the desktop app. This file is the brief for a new repository (`shiftpane-web`), written so a fresh
session that has never seen the ShiftPane repo can start from it.

The ShiftPane repo keeps the app, the widget SDK, the widget runtime and the CLI. This repo is the site, the
registry behind it, and the review pipeline.

## Decisions at a glance

| Question | Decision |
| --- | --- |
| Where do the docs live? | Here, on the same site as the marketplace: one domain, one deploy, one look. The ShiftPane repo keeps only its README and contributor notes. |
| Do we need a new site for widgets? | Yes: a website to browse and upload, and a small API the desktop app installs from. Installing happens in the desktop app, because the PC runs the widget. |
| Who controls what gets listed? | We do. Anyone signed in can upload; nothing is public until it passes automated checks and a human approves it. |
| Is that still open source? | Yes. Open source is about the code's license, not about who curates a store. The app, SDK and widget format stay MIT; every listed widget ships readable source under an OSI license; the app can sideload widgets from a folder, so the store is the default and not a lock-in. |
| This repo: public or private? | Private while we build it (it holds moderation rules and the admin). It can be opened later without changing anything else. |
| How do people make widgets? | Three ways, one package format: a no-code builder in the desktop app, the AI generator, and an SDK + CLI for developers. See "Making widgets". |
| How do widgets get PC data (CPU, GPU, media...)? | From **system sources** the app provides. A widget declares the sources it reads and binds them in its view; it never touches the OS itself. |
| Money? | No payments. Free widgets only. |
| Hosting? | Frontend on Vercel (Hobby, free). API and Postgres on Heroku, paid by the GitHub Student Developer Pack credit ($13/month for 24 months), so it must stay under $13/month. **Deployment is on hold until the Student Pack is approved**: build and test locally until then. See "Hosting and budget". |

## Context: ShiftPane and its widgets today

ShiftPane (github.com/kwiruu/shiftpane, MIT) turns a phone into a second monitor plus a live widget board.

- **Desktop app** (Electron): pairs with phones, serves the phone app, runs widget collectors on the PC.
- **Native helper** (Rust): the only process that talks to OS APIs. Already reports CPU %, memory, GPU %, network
  rates and what media is playing, and presses media buttons.
- **Phone app** (PWA): shows the widget board. It only ever receives finished data from the PC.
- **`@shiftpane/widget-sdk`**: the widget contract. `manifest.json` schema (zod, with a generated JSON Schema) and
  `defineCollector`.
- **`@shiftpane/board`**: the React widget board and its parts (`Label`, `Value`, `Ring`, `Meter`, `HistoryBars`,
  `Sparkline`), shared by the phone and the desktop.

A widget has two halves:

1. A **collector** that runs on the PC on a timer and returns plain JSON. It gets a `fetch` limited to the hosts in
   `permissions.network`, the secrets in `permissions.secrets`, its config and an abort signal.
2. A **view** that renders that JSON on the phone.

**The catch:** today every widget is built in. `WidgetKind` in `@shiftpane/protocol` is a fixed enum, the views are
hardcoded React components, and the collectors are hardcoded in the desktop main process. Before a marketplace is
useful, the app has to load and run a widget it did not ship with. That is milestone A0 below, in the ShiftPane repo.

## Making widgets

### Three ways in, one package out

| Who | Tool | What they make |
| --- | --- | --- |
| Anyone | **Widget Studio** in the desktop app: pick a source, pick a component, see it live on your phone | Widgets that show PC data or a phone-only thing (clock, countdown). No code. |
| Anyone | **AI generator** in the desktop app: describe it in a sentence; it opens in Widget Studio to adjust | Same, plus simple collectors |
| Developers | **SDK + CLI**: `npm create shiftpane-widget`, `shiftpane-widget dev` | Anything the permissions allow: web APIs, local apps, logic |

All three write the same folder (below), so all three can be shared to the marketplace. Most PC-stats widgets are
pure bindings and need no code at all, which also makes them the cheapest to review.

### System sources: how a widget gets PC data

The app reads the PC once and shares the result with every widget that asked for it. A widget lists the sources it
reads in its manifest (`permissions.sources`), then either binds them in `view.json` (`"bind": "@gpu/percent"`) or
reads them in its collector (`ctx.sources.gpu.percent`). Each source has a zod schema in `@shiftpane/widget-sdk`, so
authors get types and the docs get a generated reference. A source is read only while a shown widget uses it, at the
fastest rate any of them asks for, the way the built-in PC stats widget works today.

| Source | Gives | Asks the user | Today |
| --- | --- | --- | --- |
| `cpu` | percent, per-core percent, history | no | percent |
| `memory` | percent, used, total, history | no | yes |
| `gpu` | percent, VRAM used/total, history | no | percent |
| `network` | received/sent per second, history | no | yes |
| `disks` | per drive: used/total, read/write per second | no | new |
| `battery` | percent, charging, time left | no | new |
| `audio` | output volume, muted, device name | no | new |
| `system` | uptime, OS name and version | no | new |
| `temperatures` | CPU/GPU °C, fan RPM, where the OS allows (GPU via vendor APIs; CPU on Windows needs a kernel driver, so later and only via apps like LibreHardwareMonitor) | no | new |
| `media` | now playing: title, artist, app, status | yes | yes |
| `processes` | top N by CPU or memory: name, percent | yes | new |
| `active-window` | foreground app and window title | yes | new |

"Asks the user" sources reveal what you are doing, so installing a widget that reads them shows a prompt.

Never offered, to anyone: files, clipboard, keystrokes, screen contents, running commands, other widgets' secrets.

**Actions** are the other direction: buttons on the phone that do something on the PC. They come from a fixed list
the app implements (`media.play-pause`, `media.next`, `media.previous`, `audio.set-volume`, `audio.toggle-mute`), and a
widget lists the ones it uses in `permissions.actions`. A message from the phone names an action, never a command.
Later: macro buttons where the user binds what a button does on the PC (launch an app, a shortcut) and the widget only
says "button 3 pressed", like a Stream Deck.

**Apps on this PC or LAN** (LibreHardwareMonitor's web server, OBS WebSocket, Home Assistant, Ollama) are reached
through `permissions.local: ["127.0.0.1:8085"]`, exact host and port, with a prompt. This is how people get data the
app does not provide, without the app growing a source for every program.

**The flow rule.** Data may flow from sources to the phone freely. A widget that reads an "asks the user" source and
also has `network` or `local` permissions could send that data off the PC, so it gets a stronger prompt and always a
human review.

### What a developer gets

- `npm create shiftpane-widget@latest`: templates for *PC data* (bindings only), *web API* (collector + fetch),
  *local app* (localhost) and *phone only*.
- `shiftpane-widget dev`: connects to the desktop app running on the same PC (Developer mode in Settings, which shows
  a one-time token), sideloads the folder, reloads on save and shows the widget on your paired phone and in a browser
  preview at every size. Sources are your PC's real data; without the app running, the preview uses `sample.json`.
- Types generated from `manifest.json` (`ctx.sources` has exactly the sources you declared), and JSON Schemas for
  `manifest.json` and `view.json` so editors autocomplete them.
- `shiftpane-widget validate` runs the marketplace's own checks locally; `pack` makes the zip; `publish` uploads it.

```ts
// collector.js: "is my PC busy?", from two sources and one config value
import { defineCollector } from '@shiftpane/widget-sdk'

export default defineCollector(({ sources, config }) => {
  const cpu = sources.cpu.percent ?? 0
  const memory = sources.memory.percent ?? 0
  return { busy: cpu > config.threshold || memory > config.threshold, cpu, memory }
})
```

**Proof the SDK is enough:** the built-in PC stats and media widgets are rebuilt as widget packages on it. If they
cannot be, the SDK is missing something.

## Widget package format (v1)

A widget is a folder, packed into a deterministic zip.

```text
gpu-ring/
  manifest.json      required
  view.json          required: how the phone draws the data
  sample.json        required: an example of the data the view binds to; used for previews, review and the demo
  collector.js       optional: one ESM file, default export defineCollector(...); absent for binding-only widgets
  icon.png           optional: 256x256 PNG (no SVG: it can carry script)
  README.md          required
  LICENSE            required
  screenshots/*.png  optional
```

Rules: fixed file names, nothing else in the zip, total at most 1 MB, `collector.js` at most 256 KB and not minified.
The CLI bundles npm dependencies into `collector.js` as readable code, so reviewers read exactly what runs.

```jsonc
{
  "id": "gpu-ring",                 // lowercase-kebab, max 64
  "name": "GPU ring",
  "description": "GPU load as a ring, with the last minute below it",
  "version": "1.0.0",
  "author": "octocat",
  "license": "MIT",                 // new: SPDX, OSI-approved
  "repository": "https://github.com/octocat/gpu-ring",   // new, optional
  "categories": ["system"],         // new: system, dev, productivity, media, finance, weather, fun, other
  "minAppVersion": "0.5.0",         // new
  "sizes": ["small", "medium"],
  "permissions": {
    "sources": ["gpu"],             // new: PC data it reads
    "actions": [],                  // new: PC buttons it presses
    "local": [],                    // new: apps on this PC or LAN, host:port
    "network": [],                  // internet hosts its collector may fetch
    "secrets": []
  },
  "config": []
}
```

### The view: declarative JSON, not code

`view.json` is a tree of ShiftPane's own components, one tree per supported size. `@name/...` binds a system source,
`/...` binds the collector's output (JSON Pointer), `{config.key}` inserts a config value. The phone renders it with
`@shiftpane/board`; no third-party code ever runs on the phone.

```json
{
  "small": {
    "type": "stack",
    "children": [
      { "type": "label", "text": "GPU" },
      { "type": "ring", "bind": "@gpu/percent" },
      { "type": "history-bars", "bind": "@gpu/history" }
    ]
  }
}
```

v1 components: `stack`, `row`, `grid`, `label`, `text`, `value` (number formats), `ring`, `meter`, `history-bars`,
`sparkline`, `list` (title, subtitle, value per item), `icon` (a Solar icon name from `@shiftpane/ui`), `progress`,
`button` (fires a declared action). No remote images in v1: an image URL would make the phone call out and leak its IP.

Why declarative: safe by construction, every widget matches the app's look, easy for Widget Studio and the AI
generator to produce, and it validates against `sample.json` before anyone runs it. A sandboxed-iframe "custom view"
tier can come later, behind stricter review.

## Security model

The PC side is where the risk is: a collector is code from a stranger running on the user's machine.

**Collector sandbox** (`@shiftpane/widget-runtime`, ShiftPane repo)

- Runs in QuickJS compiled to WebAssembly (`quickjs-emscripten`), not in Node. No `require`, no filesystem, no
  process, no Electron. Bundled by electron-vite, so the packaged app still ships no `node_modules`.
- Limits per run: 32 MB memory, 10 s wall clock, output at most 64 KB of JSON, validated before it goes to the phone.
- `ctx.sources` is a read-only snapshot of the declared sources, taken by the app.
- `fetch` is a host function implemented by the desktop app:
  - host must match `permissions.network` (https only), or exactly match a `permissions.local` host:port;
  - for `network` hosts, resolve DNS first and refuse loopback, private, link-local and CGNAT addresses, so a widget
    cannot reach the user's router or LAN services by pointing a public name at them;
  - response size cap (2 MB) and per-widget rate limit.
- Secrets live encrypted on the PC (Electron `safeStorage`) and go only to the widget that declared them.
- The same package runs collectors in the desktop app, in `shiftpane-widget dev`, and in this repo's API job runner.

**Install-time permissions.** Installing shows what the widget can do in plain words ("Reads your GPU load. Can reach
api.github.com. Needs your GITHUB_TOKEN."). An update that adds any permission asks again; one that does not is
applied silently.

**Signed distribution.**

- The registry signs `index.json` and `revoked.json` with an Ed25519 key (detached `.sig` files). The app ships the
  public key, plus a second "next" key for rotation.
- Each version in the index carries its package's sha256. Packages are immutable and content-addressed on the CDN.
- The app refuses a package whose hash or index signature does not check out.

**Kill switch.** The app reads `revoked.json` at start and every 6 hours and disables any revoked version at once,
with the reason shown.

**Secret exfiltration.** A widget that declares `GITHUB_TOKEN` and also `evil.example` can send the token there.
Review rule: a widget with secrets may only declare hosts that belong to the service that issued them.

## Marketplace flows

**Author publishes.** Builds with Widget Studio, the generator or the CLI. Shares from the app (signs in with GitHub
by device code) or uploads the zip on the site. Sees the automated report at once; the version waits for review;
gets an email when it is approved or rejected, with the reviewer's note.

**Reviewer approves.** The admin queue shows the automated report, the permissions, a diff against the previous
version, the collector source, a preview rendered from `sample.json` and an AI summary. Approve signs and publishes;
reject needs a note.

**User installs.** From the desktop app's "Get widgets" page (reads the index directly), or Install on the website,
which opens `shiftpane://install/<id>`. The app downloads, verifies, shows permissions, installs to
`userData/widgets/<id>/<version>/`, and the widget appears in the layout editor's picker.

**Takedown.** Anyone signed in can report a widget. An admin yanks a version or the whole widget; it lands in
`revoked.json` and every app disables it within 6 hours.

## Moderation

**Automated checks.** *Fail* blocks the upload; *flag* goes to the reviewer.

| Check | Result |
| --- | --- |
| Zip layout, file allowlist, size limits | fail |
| `manifest.json` parses with `@shiftpane/widget-sdk`; id not taken by another owner or reserved (`pc-stats`, `media`, `clock`, ...) | fail |
| Version is higher than the last published one | fail |
| `view.json` parses; every `/` binding resolves in `sample.json`; every `@` binding is a declared source; every button is a declared action | fail |
| `license` is OSI-approved and `LICENSE` exists | fail |
| `collector.js` parses as one ESM module with no imports | fail |
| Embedded credentials (secret-scanner patterns) | fail |
| Minified or obfuscated code (long lines, entropy, `eval`, `Function`, `atob` of big blobs) | flag |
| Collector runs in the sandbox with the default config and sample sources, network mocked, within limits | flag on error |
| Secrets declared with hosts that do not belong to the secret's service | flag |
| An "asks the user" source together with `network` or `local` | flag, always human review |
| Any `local` permission | flag |
| Hosts on a tracking or analytics blocklist | flag |
| Permissions added since the previous version | flag, always human review |
| AI review (Claude, `claude-sonnet-5-5`): "what does this code do, and does it match the description and permissions?" | flag, advice only |

**Human review.** Every new widget and every version that changes permissions. Fast lane later: binding-only widgets
(no collector) and authors with a track record can publish after automated checks when permissions did not change.

**Content policy** (on the site, linked from upload): no obfuscated code, only the access the widget needs, secrets
go only to their issuer, no tracking or ads, no impersonating brands or other authors, nothing adult or hateful, an
OSI license, and we may remove anything at any time.

**Abuse limits.** Uploads per account per day, GitHub accounts younger than 30 days flagged, everything logged.

## The docs

User docs and author docs on the same site, written in MDX.

- **Get started:** install per OS (Windows needs Virtual Display Driver once; macOS and Linux do not), pair a phone,
  the certificate warning, picking the network adapter, iPhone home-screen pairing by code.
- **Using ShiftPane:** display mode, split view, the widget board and layout editor, devices, troubleshooting, privacy
  (what leaves the PC: video and finished widget data only).
- **Making widgets:** quickstart with each template, Widget Studio, `view.json` components, system sources, actions,
  collectors, permissions, publishing, the content policy.
- **Reference, generated:** system sources, view components and manifest fields, from the JSON Schemas the SDK
  publishes, so the docs cannot drift from the app.
- **Later:** an embedded phone demo (the phone app's demo-mode build from ShiftPane's releases).

The ShiftPane README is the source for the user docs. A cloud session on this repo cannot read the ShiftPane repo
unless it is public or added to the session, so copy the relevant README sections in when starting.

## Architecture and stack

Same tooling as ShiftPane: pnpm workspaces + Turborepo, TypeScript, Biome, Vitest, zod.

| Piece | Choice | Why |
| --- | --- | --- |
| Site and docs | Next.js (App Router) on Vercel, docs with Fumadocs | Static and ISR pages on a CDN, MDX docs, preview deploys per PR; no server code here |
| API | Hono on Node, on one Heroku dyno | Small, typed, zod validation on every route; runs anywhere Node runs |
| Database | Heroku Postgres via Drizzle | Covered by the student credit; migrations in TS |
| Background jobs | pg-boss inside the API process | Postgres-backed queue (`SKIP LOCKED`), so no worker dyno and no queue service |
| Package storage | Cloudflare R2 behind a `cdn.` subdomain | Heroku's disk is wiped on every restart; R2's free tier covers this and egress is free |
| Auth | GitHub OAuth in the API (arctic), sessions in Postgres, httpOnly cookie | Authors are developers; GitHub gives a stable identity and an abuse signal |
| Signing | Ed25519 key as a Heroku config var, used only by the publish step | Built into Node's `crypto` |
| Email | Resend, free tier | Approve and reject notices |
| Local dev and tests | PGlite (Postgres in WASM) and a filesystem storage adapter | No Docker needed, so cloud sessions can run everything |

### Hosting and budget

**Status: on hold.** Nothing is deployed and no Heroku, Vercel or Cloudflare resources are created until the GitHub
Student Developer Pack is approved. Until then, everything runs locally.

```text
 browser ──▶ shiftpane.dev (Vercel) ── /api/* rewrite ──▶ Heroku: API dyno ──▶ Heroku Postgres
                                                              │
 desktop app ──▶ cdn.shiftpane.dev (R2) ◀── publishes ────────┘
                 index.json, revoked.json, packages
```

- The site calls the API through a Vercel rewrite (`/api/:path*` to the Heroku app), so the browser sees one origin:
  no CORS, first-party cookies, and the API needs no custom domain.
- The desktop app reads the signed index and the packages straight from the CDN, never from Heroku. Installing keeps
  working while the API restarts, deploys or is down.

| Item | Monthly |
| --- | --- |
| Heroku Basic dyno: API, auth, uploads and the job runner in one process; never sleeps | $7 |
| Heroku Postgres Essential-0 | $5 |
| **Heroku total, paid by the $13 credit** | **$12** |
| Vercel Hobby (free; non-commercial use, which fits free widgets) | $0 |
| Cloudflare R2 free tier, Cloudflare DNS | $0 |
| Resend free tier | $0 |
| Claude API for AI review (optional, off by default; not covered by the credit) | cents |
| Domain: free for the first year from the Student Pack, then about $10 to $20 a year | $0 |

Rules that keep it at $12:

- One dyno, one database. No worker dyno, no staging app, no review apps, no extra Heroku add-ons (third-party
  add-ons are not covered by the credit at all). Heroku charges the card for anything above $13.
- If more headroom is needed, an Eco dyno ($5, sleeps after 30 idle minutes) brings Heroku to $10. Sleeping is
  bearable because the app never depends on the API.
- Keep the Postgres pool small (Essential-0 allows 20 connections in total, shared by the API, pg-boss and the
  release-phase migration).
- No headless browser on the dyno (512 MB of memory, and the slug size limit). Widget previews render in the visitor's
  browser from `sample.json` instead of server-side screenshots.
- Vercel preview deploys read the production API for public pages only; sign-in is disabled in previews.
- The credit lasts 24 months. Everything here is plain Node, Postgres and the S3 API, so it can move to another host
  before then.

Heroku setup (for when it is approved): a `Procfile` with `web` (start the API) and `release` (run Drizzle
migrations); a root `heroku-postbuild` that builds only `apps/api`; pnpm through the `packageManager` field; the
database connection with SSL as Heroku Postgres requires.

Shared code comes from the ShiftPane repo as npm packages: `@shiftpane/widget-sdk` (manifest, view and source
schemas, validators) and `@shiftpane/widget-runtime` (sandbox). Until they are published, vendor the SDK's `src/` into
`packages/vendor-sdk` with a CI job that fails when it drifts from the ShiftPane repo. (A pnpm git dependency,
`github:kwiruu/shiftpane#path:/packages/widget-sdk`, is tidier but may not resolve the SDK's `catalog:` versions
outside its own workspace; try it first.)

### Repository layout

```text
apps/
  web/          Next.js on Vercel: landing, docs (/docs), marketplace (/widgets), upload, author dashboard, admin
    content/docs/   MDX
  api/          Hono on Heroku: REST API, GitHub sign-in, uploads, pg-boss jobs (sandbox smoke run, AI review),
                publishing to R2; Procfile at the repo root
packages/
  db/           Drizzle schema, migrations, queries
  checks/       Pure check functions (zip layout, manifest, view bindings, scanners); used by the API and tests
  index/        Builds, signs and verifies index.json and revoked.json; the verify half is what the app uses
  storage/      One interface, two adapters: R2 (production) and the filesystem (local dev, tests)
  ui/           Site components (reuse ShiftPane's graphite tokens)
```

### Data model

```text
users        id, github_id, login, avatar, role (author | reviewer | admin), created_at, banned_at
sessions     id (hashed), user_id, expires_at, created_at
widgets      id (the manifest id, unique), owner_id, name, summary, categories, status (live | yanked), created_at
versions     id, widget_id, version, manifest (jsonb), permissions (jsonb), sha256, size, storage_key, has_collector,
             status (checking | in_review | approved | rejected | yanked), report (jsonb), submitted_at, published_at
reviews      id, version_id, reviewer_id, decision, note, created_at
reports      id, widget_id, version_id?, reporter_id?, reason, body, status, created_at
api_tokens   id, user_id, hash, name, last_used_at, revoked_at
(pg-boss keeps its own job tables in a separate schema)
```

### API

Static files on the CDN (R2), what the desktop app uses. Rewritten by the API whenever something is approved or
yanked:

```text
GET  cdn/index.json, cdn/index.json.sig       every live widget and its versions
GET  cdn/revoked.json, cdn/revoked.json.sig   yanked versions
GET  cdn/packages/<sha256>.zip                immutable packages
```

The API, at `/api/v1` behind the site's rewrite:

```text
GET  /api/v1/widgets, /api/v1/widgets/:id      listing, search and detail for the site
GET  /api/v1/auth/github, .../callback         sign-in
POST /api/v1/device-code                       sign-in from the desktop app and the CLI (OAuth device flow)
POST /api/v1/uploads                           multipart zip -> version in "checking"; returns the static check report
GET  /api/v1/me/widgets                        author dashboard data
POST /api/v1/widgets/:id/versions/:v/yank      owner or admin
POST /api/v1/reports                           anyone signed in
POST /api/v1/admin/versions/:id/approve        reviewer; signs, uploads to R2, rewrites the index
POST /api/v1/admin/versions/:id/reject         reviewer; note required
```

Download counts are left for W5: the app downloads straight from the CDN, so counting needs either a redirect through
the API (which would make installs depend on Heroku) or a small Cloudflare Worker on the CDN route (free tier).

`index.json` entry:

```json
{
  "id": "gpu-ring",
  "name": "GPU ring",
  "summary": "GPU load as a ring, with the last minute below it",
  "author": { "login": "octocat" },
  "categories": ["system"],
  "latest": "1.0.0",
  "versions": {
    "1.0.0": {
      "sha256": "…",
      "size": 4180,
      "url": "https://cdn.example/packages/….zip",
      "minAppVersion": "0.5.0",
      "permissions": { "sources": ["gpu"], "actions": [], "local": [], "network": [], "secrets": [] }
    }
  }
}
```

Installing and updating only download from the CDN. The app talks to the API only when someone shares a widget from
it. No telemetry.

### Site pages

Landing · docs · marketplace home (featured, new, categories) · search · widget page (README, permissions in plain
words, screenshots or live preview, versions, source viewer, Install button) · author profile · upload · author
dashboard · admin review queue · admin reports · content policy.

## Milestones

Two tracks. The app track is in the ShiftPane repo; the web track is this repo. W1 and W2 can start right away.

### App track (ShiftPane repo)

**A0: run third-party widgets.** Manifest additions; `view.json`, `sample.json` and system-source schemas in the SDK;
view renderer in `@shiftpane/board`; source registry in the desktop main process over the helper's existing stats and
media; `@shiftpane/widget-runtime` (QuickJS sandbox, guarded fetch, limits); board protocol refers to installed widgets
by id, not only the `WidgetKind` enum; installed-widget store, permission prompt, secrets entry, sideload a folder in
Developer mode. *Done when* a GPU-ring folder (bindings only) and a GitHub-stars folder (collector + fetch) are
sideloaded, ask for their permissions, and show on a paired phone; and the GitHub one cannot reach any other host.

**A1: SDK and CLI.** New sources (disks, battery, audio, system, per-core CPU, processes, active window); actions;
`local` permission; publish `@shiftpane/widget-sdk` and `@shiftpane/widget-runtime` to npm (they need a build step,
unlike the internal packages); `create-shiftpane-widget`; `shiftpane-widget dev | validate | pack`; rebuild the
built-in PC stats and media widgets as packages. *Done when* a developer goes from `npm create` to their widget on
their phone with live data in under five minutes.

**A2: Widget Studio.** No-code builder in the desktop window: sources, components, live phone preview, saves a
package. The AI generator outputs packages and opens them in Studio. *Done when* someone who never wrote code makes a
CPU + GPU widget and shares it.

**A3: marketplace client.** "Get widgets" page, `shiftpane://install` deep link, signature and hash checks, updates
with the permission diff, `revoked.json`, Share (device-code sign-in + upload). *Done when* a tampered package or
index is refused and a yanked version is disabled within one refresh.

### Web track (this repo)

**W1: docs site.** Landing and the docs listed above, written from the ShiftPane README; reference pages generated
once the SDK publishes its schemas (vendored until then). *Done when* someone can install, pair and make their first
widget from the docs alone.

**W2: read-only gallery.** Widget pages and search, seeded with 3 to 5 first-party widgets; `packages/index` builds
and signs the index; packages on R2. *Done when* (with A3) a user installs a widget from the site into the app.

**W3: uploads and review.** GitHub sign-in, upload, static checks in the API, the pg-boss job runner, review queue,
approve and reject, emails, content policy. *Done when* a stranger's upload goes through checks, waits for review,
and once approved shows in the app.

**W4: updates and safety.** Versions and permission diff, yank and `revoked.json`, reports, author dashboard, live
previews rendered from `sample.json`.

**W5: growth.** API tokens and `shiftpane-widget publish`, download counts, collections, verified authors, the
fast lane.

**Deploy: blocked until the Student Pack is approved.** W1 to W3 are built and tested locally first (PGlite,
filesystem storage, `next dev`). Once approved: Heroku app with one Basic dyno and Essential-0 Postgres, config vars
(GitHub OAuth, signing key, R2 keys, Resend key), Vercel project with the `/api` rewrite, R2 bucket and `cdn.`
domain, DNS. *Done when* the site is live, the Heroku bill shows $12 or less, and the desktop app installs from the
real CDN. W1 alone can go live earlier as a static Vercel site, since it needs no backend.

## Not in scope

Payments, ratings and comments (until there is traffic to moderate them), custom HTML or JS views on the phone,
widgets with direct system access (files, processes beyond the `processes` source, the native helper), user-bound
macro buttons (later), self-hosted registries (sideloading covers "no lock-in" for now).

## Open questions

| Question | Recommendation |
| --- | --- |
| Name and domain | `shiftpane.dev` with `/docs` and `/widgets`; claim a free domain from the Student Pack and put its DNS on Cloudflare (R2 custom domains need that) |
| Allow AI-generated widgets? | Yes, through the same review; label them "made with the generator" |
| Who reviews? | You, at first. Add reviewers by role when the queue grows |
| Open-source this repo later? | Possible any time; nothing in the design depends on it being private |
| ShiftPane README and CLAUDE.md | Point them at this repo for docs and the widget gallery once it exists; drop the "planned `apps/web`" and "submitted by pull request" lines |

## Starting the cloud project

1. Create an empty private GitHub repo, `kwiruu/shiftpane-web`.
2. Commit this file as `PLAN.md`, plus copies of the ShiftPane README (`reference/shiftpane-README.md`) and of
   `packages/widget-sdk/src/` (`reference/widget-sdk/`), unless the ShiftPane repo is public.
3. Start a cloud session on that repo: "Read PLAN.md. Set up the monorepo, then do W1 and W2, vendoring the widget SDK
   from `reference/widget-sdk/`. Do not deploy or create any Heroku, Vercel or Cloudflare resources; run everything
   locally with PGlite and filesystem storage."
4. Run A0 in the ShiftPane repo at the same time.
