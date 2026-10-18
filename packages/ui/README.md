# @shiftpane/ui

The look shared by `apps/desktop`, `apps/phone` and `packages/board`: Tailwind v4 tokens, fonts and icons.

- `@shiftpane/ui/theme.css`: graphite colour tokens, Inter and Geist Mono, and the `hatched` (card frames),
  `raised` (controls), `lifted` (the chosen item) and `section-label` utilities. Import it after Tailwind.
- `@shiftpane/ui/icons`: `<Icon name="…" />`, drawn from the [Solar](https://icon-sets.iconify.design/solar/)
  set (by 480 Design, CC BY 4.0), mostly its Bold Duotone style. `src/solar.tsx` is generated: name a new icon in
  `scripts/icons.ts` and run `pnpm --filter @shiftpane/ui icons`.

Shared React components land here once both apps need the same one.
