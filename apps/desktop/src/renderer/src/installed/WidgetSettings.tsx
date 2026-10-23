import type { ConfigField } from '@shiftpane/widget-sdk'
import { useState } from 'react'
import type { InstalledInfo, ShareResult } from '../../../shared/widgets.ts'
import { Segmented } from '../layout/controls.tsx'
import { Button, Chip, Select } from '../shell/parts.tsx'
import { useAccount } from '../useAccount.ts'
import { Dialog } from './Dialog.tsx'
import { PermissionList, SendsOffPc } from './Permissions.tsx'
import { DatetimeField, LocationField } from './SpecialFields.tsx'

type Values = Record<string, string | number | boolean>

const FIELD =
  'h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-border-strong'

const ago = (at: number) => {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return `${Math.round(seconds / 3600)} h ago`
}

/**
 * One installed widget's settings: what it may do, its config and secrets, how its collector
 * did last, and (in Developer mode) loading it again from its folder. Removing it is here too.
 */
export function WidgetSettings({
  widget,
  developer,
  onClose,
  onReload,
  onEdit,
}: {
  widget: InstalledInfo | null
  developer: boolean
  onClose: () => void
  /** Load it again from its folder: checked, then confirmed like a first install. */
  onReload: (id: string) => void
  /** Opens it in Widget Studio, for a widget Studio made. */
  onEdit?: () => void
}) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (!widget) return null

  const close = () => {
    setConfirmRemove(false)
    onClose()
  }
  const remove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true)
      return
    }
    await window.shiftpane.widgets.remove(widget.id)
    close()
  }

  return (
    <Dialog
      open
      title={widget.name}
      icon="settings"
      onClose={close}
      footer={
        <>
          <Button
            tone="danger"
            icon="trash"
            size="md"
            onClick={() => void remove()}
            onBlur={() => setConfirmRemove(false)}
            className="mr-auto"
          >
            {confirmRemove ? 'Click again to remove it' : 'Remove'}
          </Button>
          {onEdit && (
            <Button icon="widgets" size="md" onClick={onEdit}>
              Edit in Studio
            </Button>
          )}
          {developer && (
            <Button icon="refresh" size="md" onClick={() => onReload(widget.id)}>
              Load again
            </Button>
          )}
          <Button tone="primary" size="md" onClick={close}>
            Done
          </Button>
        </>
      }
    >
      <p className="text-ink-soft text-sm">{widget.description}</p>
      <p className="mt-2 font-mono text-ink-muted text-xs">
        v{widget.version} · by {widget.author} · {widget.license}
      </p>
      <p className="mt-1 break-all font-mono text-ink-faint text-xs">
        {widget.origin.kind === 'folder'
          ? `From the folder ${widget.origin.path}`
          : 'From the ShiftPane marketplace'}
      </p>

      {widget.hasCollector && <Status widget={widget} />}

      {widget.config.fields.length > 0 && (
        <ConfigForm key={`${widget.id}:${widget.updatedAt}`} widget={widget} />
      )}
      {widget.secrets.length > 0 && <Secrets widget={widget} />}
      {developer && widget.origin.kind === 'folder' && <Share key={widget.id} widget={widget} />}

      <h3 className="section-label mt-6 mb-3">What it can do</h3>
      <PermissionList lines={widget.permissions} />
      {widget.sendsOffPc && <SendsOffPc />}
    </Dialog>
  )
}

function Status({ widget }: { widget: InstalledInfo }) {
  const { lastRunAt, problem } = widget.status
  const every =
    widget.refreshSeconds >= 60
      ? `${Math.round(widget.refreshSeconds / 60)} min`
      : `${widget.refreshSeconds} s`
  return (
    <p className={`mt-4 text-xs ${problem ? 'text-warn' : 'text-ink-muted'}`}>
      {problem ??
        (lastRunAt === null
          ? `Runs every ${every} while a phone shows it.`
          : `Updated ${ago(lastRunAt)}; runs every ${every} while a phone shows it.`)}
    </p>
  )
}

function ConfigForm({ widget }: { widget: InstalledInfo }) {
  const [values, setValues] = useState<Values>(widget.config.values)
  const [problems, setProblems] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const set = (key: string, value: string | number | boolean | undefined) => {
    setSaved(false)
    setValues((current) => {
      const next = { ...current }
      if (value === undefined) delete next[key]
      else next[key] = value
      return next
    })
  }
  const save = async () => {
    const result = await window.shiftpane.widgets.setConfig(widget.id, values)
    setProblems(result)
    setSaved(result.length === 0)
  }

  return (
    <form
      className="mt-6"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <h3 className="section-label mb-3">Settings</h3>
      <div className="flex flex-col gap-3">
        {widget.config.fields.map((field) => (
          <Field
            key={field.key}
            widgetId={widget.id}
            field={field}
            value={values[field.key]}
            onChange={set}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {problems.length > 0 && <p className="mr-auto text-danger text-xs">{problems[0]}</p>}
        {saved && <p className="mr-auto text-ok text-xs">Saved. It runs again with these.</p>}
        <Button type="submit" size="md">
          Save settings
        </Button>
      </div>
    </form>
  )
}

function Field({
  widgetId,
  field,
  value,
  onChange,
}: {
  widgetId: string
  field: ConfigField
  value: string | number | boolean | undefined
  onChange: (key: string, value: string | number | boolean | undefined) => void
}) {
  const label = (
    <span className="mb-1.5 flex items-baseline gap-2 text-sm">
      <span className="text-ink-soft">{field.label}</span>
      {field.required && <span className="text-ink-faint text-xs">required</span>}
    </span>
  )
  const help = field.help && <span className="mt-1 block text-ink-muted text-xs">{field.help}</span>
  switch (field.type) {
    case 'location':
    case 'datetime':
      return (
        <div>
          {label}
          {field.type === 'location' ? (
            <LocationField
              id={widgetId}
              value={value}
              onChange={(next) => onChange(field.key, next)}
            />
          ) : (
            <DatetimeField value={value} onChange={(next) => onChange(field.key, next)} />
          )}
          {help}
        </div>
      )

    case 'string':
      return (
        <label className="block">
          {label}
          <input
            className={FIELD}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(field.key, event.target.value || undefined)}
            spellCheck={false}
          />
          {help}
        </label>
      )
    case 'number':
      return (
        <label className="block">
          {label}
          <input
            className={FIELD}
            type="number"
            min={field.min}
            max={field.max}
            value={typeof value === 'number' ? value : ''}
            onChange={(event) =>
              onChange(
                field.key,
                event.target.value === '' ? undefined : Number(event.target.value),
              )
            }
          />
          {help}
        </label>
      )
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-ink-soft text-sm">{field.label}</span>
            {help}
          </div>
          <Segmented
            label={field.label}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'on', label: 'On' },
            ]}
            value={value === true ? 'on' : 'off'}
            onChange={(next) => onChange(field.key, next === 'on')}
          />
        </div>
      )
    case 'select':
      return (
        <div className="block">
          {label}
          <Select
            aria-label={field.label}
            className="w-full"
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(field.key, event.target.value || undefined)}
          >
            <option value="">Pick one</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {help}
        </div>
      )
  }
}

/** Each secret the widget declares: set or not, and a way to set or clear it. Never shown back. */
function Secrets({ widget }: { widget: InstalledInfo }) {
  return (
    <div className="mt-6">
      <h3 className="section-label mb-1.5">Secrets</h3>
      <p className="mb-3 text-ink-muted text-xs">
        Kept encrypted on this PC and given only to this widget. They never reach your phone.
      </p>
      {!widget.secretsAvailable && (
        <p className="mb-3 text-warn text-xs">This PC has no keychain to keep secrets in.</p>
      )}
      <div className="flex flex-col gap-3">
        {widget.secrets.map((secret) => (
          <Secret
            key={secret.name}
            id={widget.id}
            name={secret.name}
            set={secret.set}
            disabled={!widget.secretsAvailable}
          />
        ))}
      </div>
    </div>
  )
}

function Secret({
  id,
  name,
  set,
  disabled,
}: {
  id: string
  name: string
  set: boolean
  disabled: boolean
}) {
  const [value, setValue] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const save = async (next: string | null) => {
    const result = await window.shiftpane.widgets.setSecret(id, name, next)
    setProblem(result)
    if (result === null) setValue('')
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (value) void save(value)
      }}
    >
      <span className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-ink-soft text-xs">{name}</span>
        <Chip className={set ? 'text-ok' : ''}>{set ? 'Set' : 'Not set'}</Chip>
      </span>
      <div className="flex gap-2">
        <input
          className={FIELD}
          type="password"
          autoComplete="off"
          placeholder={set ? 'Enter a new value to replace it' : 'Paste it here'}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" size="md" disabled={disabled || !value}>
          Save
        </Button>
        {set && (
          <Button size="md" tone="ghost" onClick={() => void save(null)}>
            Clear
          </Button>
        )}
      </div>
      {problem && <p className="mt-1 text-danger text-xs">{problem}</p>}
    </form>
  )
}

/**
 * Sending a widget made in a folder to the marketplace for review: signed in with a code typed on
 * github.com, as the author the manifest names.
 */
function Share({ widget }: { widget: InstalledInfo }) {
  const account = useAccount()
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ShareResult | null>(null)
  const share = async () => {
    setBusy(true)
    setResult(await window.shiftpane.widgets.share(widget.id, notes))
    setBusy(false)
  }
  return (
    <div className="mt-6">
      <h3 className="section-label mb-1.5">Share to the marketplace</h3>
      <p className="mb-3 text-ink-muted text-xs">
        Packs this folder like shiftpane-widget pack and sends it for review. It shows on the site
        once a person has approved it.
      </p>
      {account.status === 'signed-out' && (
        <div className="flex items-center gap-3">
          <Button size="md" onClick={() => void window.shiftpane.account.signIn()}>
            Sign in with GitHub
          </Button>
          {account.problem && <p className="text-danger text-xs">{account.problem}</p>}
        </div>
      )}
      {account.status === 'waiting' && (
        <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
          <p className="text-ink-soft">
            Type this code at{' '}
            <span className="font-mono">{account.verificationUri.replace('https://', '')}</span>,
            which just opened in your browser:
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="select-text font-mono text-ink text-xl tracking-[0.2em]">
              {account.userCode}
            </span>
            <Button tone="ghost" onClick={() => void window.shiftpane.account.cancel()}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {account.status === 'signed-in' && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center justify-between text-ink-soft text-sm">
            <span>
              Signed in as <span className="font-mono">{account.login}</span>
            </span>
            <button
              type="button"
              onClick={() => void window.shiftpane.account.signOut()}
              className="text-ink-muted text-xs hover:text-ink"
            >
              Sign out
            </button>
          </p>
          {widget.author.toLowerCase() !== account.login.toLowerCase() && (
            <p className="text-warn text-xs">
              Its manifest says the author is {widget.author}; the marketplace takes it only from
              that GitHub account.
            </p>
          )}
          <input
            className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none placeholder:text-ink-faint focus:border-border-strong"
            placeholder="What's new in this version (optional)"
            maxLength={500}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <div className="flex justify-end">
            <Button tone="primary" size="md" disabled={busy} onClick={() => void share()}>
              Share v{widget.version}
            </Button>
          </div>
        </div>
      )}
      {result?.ok && (
        <p className="mt-2 text-ok text-xs">
          Sent {result.widgetId} {result.version} for review ({result.status.replace('_', ' ')}).
        </p>
      )}
      {result && !result.ok && (
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-danger text-xs">
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
