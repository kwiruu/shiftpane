# @shiftpane/widget-sdk

The format of a [ShiftPane](https://github.com/kwiruu/shiftpane) widget: the `manifest.json`,
`view.json` and `sample.json` schemas (zod, plus a JSON Schema for editors), the system sources a
widget can read, permissions in plain words, and `defineCollector` for typing a collector.

```js
import { defineCollector } from '@shiftpane/widget-sdk'

export default defineCollector(async ({ config, secrets, sources, fetch }) => {
  const answer = await fetch(`https://api.github.com/repos/${config.repo}`)
  return { stars: (await answer.json()).stargazers_count }
})
```

Start a widget with `npm create shiftpane-widget`, and check, run and pack it with
[`shiftpane-widget`](https://www.npmjs.com/package/shiftpane-widget). Docs:
https://shiftpane.vercel.app/docs/making-widgets

Config fields include `location` (a selected city serialized as JSON text) and `datetime` (an ISO timestamp with an explicit offset), available in ShiftPane 0.6.0. City search requires `geocoding-api.open-meteo.com` in network permissions. `icon` view nodes accept an optional `bind` for a registered icon name and retain `name` as their fallback.

For a single oversized number, value nodes support `size: "hero"`, with an optional raised `unit`. Units accept the same bound placeholders as text nodes.

A root stack or row may set `surface: "blue"` or `surface: "violet"` for a full-card gradient with white text.

### Battery gauge

`{ "type": "battery-gauge", "bind": "@battery" }` draws a black and purple battery card from an object containing nullable `percent`, `charging`, and `minutesLeft` fields. Declare the `battery` source permission. Supported since app 0.6.0; charging shows a bolt, unknown estimates are omitted, and absent readings show “Battery unavailable”.
