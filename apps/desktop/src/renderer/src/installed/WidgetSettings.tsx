import type { ConfigField } from '@shiftpane/widget-sdk'
import { useState } from 'react'
import type { InstalledInfo } from '../../../shared/widgets.ts'
import { Segmented } from '../layout/controls.tsx'
import { Button, Chip, Select } from '../shell/parts.tsx'
import { Dialog } from './Dialog.tsx'
import { PermissionList, SendsOffPc } from './Permissions.tsx'

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
}: {
  widget: InstalledInfo | null
  developer: boolean
  onClose: () => void
  /** Load it again from its folder: checked, then confirmed like a first install. */
  onReload: (id: string) => void
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
        From the folder {widget.origin.path}
      </p>

      {widget.hasCollector && <Status widget={widget} />}

      {widget.config.fields.length > 0 && (
        <ConfigForm key={`${widget.id}:${widget.updatedAt}`} widget={widget} />
      )}
      {widget.secrets.length > 0 && <Secrets widget={widget} />}

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
          <Field key={field.key} field={field} value={values[field.key]} onChange={set} />
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
  field,
  value,
  onChange,
}: {
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
