import { Icon, type IconName } from '@shiftpane/ui/icons'
import { type ReactNode, useEffect, useRef } from 'react'

/**
 * A modal over the window, drawn like a card: the browser's own `<dialog>`, so focus stays in it,
 * Escape closes it and the page behind it can't be clicked.
 */
export function Dialog({
  open,
  title,
  icon,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  icon?: IconName
  onClose: () => void
  children: ReactNode
  /** The buttons along the bottom. */
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-panel border border-border-strong bg-surface p-1.5 text-ink shadow-[0_24px_80px_rgb(0_0_0/0.6)] backdrop:bg-black/60"
    >
      <header className="flex min-h-10 items-center gap-2 py-1 pr-1 pl-2.5">
        {icon && <Icon name={icon} className="size-[1.125rem] text-ink-muted" />}
        <h2 className="min-w-0 truncate font-medium text-sm">{title}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="ml-auto grid size-8 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-raised hover:text-ink"
        >
          <Icon name="close" className="size-4" />
        </button>
      </header>
      <div className="max-h-[min(70vh,40rem)] overflow-y-auto rounded-inner border border-border bg-surface-sunken p-5 [scrollbar-width:thin]">
        {children}
      </div>
      {footer && (
        <footer className="flex items-center justify-end gap-2 px-1 pt-2 pb-0.5">{footer}</footer>
      )}
    </dialog>
  )
}
