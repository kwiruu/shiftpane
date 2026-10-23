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

ShiftPane 0.6.0 adds location and datetime config fields, bound icons, hero values with interpolated raised units, and blue/violet stack or row surfaces. Location search requires geocoding-api.open-meteo.com in network permissions.
