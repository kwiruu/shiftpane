import { ViewWidget } from '@shiftpane/board'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'

it('renders registered bound icons and uses the static fallback for missing or unknown names', () => {
  const render = (icon?: unknown) =>
    renderToStaticMarkup(
      createElement(ViewWidget, {
        view: { small: { type: 'icon', name: 'cloud', bind: '/icon' } },
        size: 'small',
        context: { sample: { icon } },
      }),
    )
  const fallback = render()
  expect(render('unknown-icon')).toBe(fallback)
  expect(render(42)).toBe(fallback)
  expect(render('cloud')).toBe(fallback)
  expect(render('moon')).not.toBe(fallback)
})
