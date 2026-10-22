# create-shiftpane-widget

```sh
npx create-shiftpane-widget my-widget --template web --author your-github-login
```

`npm create shiftpane-widget` is the same thing, but flags need a `--` before them, and Windows PowerShell
drops a bare `--`, so the `npx` form is the one that works in every shell. With no flags it asks.

Makes a [ShiftPane](https://github.com/kwiruu/shiftpane) widget folder: `pc` reads the PC's CPU with
no code, `web` has a collector that fetches from one host. Then `npm install` and `npm run dev`.
