import { useState } from 'react'
import type { FolderCheck } from '../../../shared/widgets.ts'
import { Button } from '../shell/parts.tsx'
import { Dialog } from './Dialog.tsx'
import { PermissionList, SendsOffPc } from './Permissions.tsx'

/**
 * Asks before a widget from a folder is installed: who made it and everything it may do, or, for
 * a newer version of one that's installed, what that version adds. A folder that isn't a widget
 * ShiftPane can load says why instead.
 */
export function InstallPrompt({
  check,
  onClose,
  onInstalled,
}: {
  check: Exclude<FolderCheck, { status: 'canceled' }> | null
  onClose: () => void
  onInstalled: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const close = () => {
    setProblem(null)
    onClose()
  }

  if (check?.status === 'invalid') {
    return (
      <Dialog
        open
        title="This folder can't be loaded"
        icon="warning"
        onClose={close}
        footer={
          <Button tone="primary" size="md" onClick={close}>
            OK
          </Button>
        }
      >
        {check.folder && (
          <p className="mb-3 break-all font-mono text-ink-muted text-xs">{check.folder}</p>
        )}
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-soft text-sm">
          {check.problems.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Dialog>
    )
  }

  const ready = check?.status === 'ready' ? check : null
  const install = async () => {
    if (!ready) return
    setBusy(true)
    const result = await window.shiftpane.widgets.install(ready.token)
    setBusy(false)
    if (result.ok) {
      setProblem(null)
      onInstalled(result.id)
    } else {
      setProblem(result.problem)
    }
  }
  const update = ready?.replaces
  const title = !ready
    ? ''
    : update
      ? `Update ${ready.widget.name} to ${ready.widget.version}?`
      : `Install ${ready.widget.name}?`

  return (
    <Dialog
      open={ready !== null}
      title={title}
      icon="widget-add"
      onClose={close}
      footer={
        <>
          {problem && <p className="mr-auto pl-2 text-danger text-xs">{problem}</p>}
          <Button size="md" onClick={close}>
            Cancel
          </Button>
          <Button tone="primary" size="md" disabled={busy} onClick={() => void install()}>
            {update ? 'Update' : 'Install'}
          </Button>
        </>
      }
    >
      {ready && (
        <>
          <p className="text-ink-soft text-sm">{ready.widget.description}</p>
          <p className="mt-2 font-mono text-ink-muted text-xs">
            {ready.widget.id} · v{ready.widget.version} · by {ready.widget.author}
          </p>
          <p className="mt-1 break-all font-mono text-ink-faint text-xs">{ready.folder}</p>

          <h3 className="section-label mt-5 mb-3">
            {update ? `New since ${update.version}` : 'What it can do'}
          </h3>
          <PermissionList
            lines={update ? update.added : ready.permissions}
            empty={update ? 'Nothing new: it may do what it could before.' : undefined}
          />
          {ready.sendsOffPc && <SendsOffPc />}
          {ready.widget.hasCollector && (
            <p className="mt-4 text-ink-muted text-xs">
              Its code runs on this PC in a sandbox that only gets what is listed here.
            </p>
          )}
        </>
      )}
    </Dialog>
  )
}
