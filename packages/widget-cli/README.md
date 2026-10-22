# shiftpane-widget

Check, run and pack [ShiftPane](https://github.com/kwiruu/shiftpane) widgets.

```sh
npx shiftpane-widget validate        # every check the marketplace runs that can run here
npx shiftpane-widget dev --config repo=kwiruu/shiftpane   # run the collector, again on every save
npx shiftpane-widget pack            # <id>-<version>.zip, the package to upload
```

Secrets a widget declares are read from environment variables of the same name (`GITHUB_TOKEN`).
Start a widget with `npm create shiftpane-widget`.
