# @shiftpane/widget-runtime

Runs [ShiftPane](https://github.com/kwiruu/shiftpane) widget packages on a PC, the way the desktop
app does: `runCollector` runs a collector in a QuickJS sandbox with a time budget and a memory
ceiling, `guardedFetch` lets it reach only the hosts its manifest lists, and `readWidgetFolder`,
`packPackage` and `openPackage` read a widget folder and pack and open the zip the marketplace
takes. Node 22 or later.
