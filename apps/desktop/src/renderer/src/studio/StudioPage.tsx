import { type PcData, WidgetCard } from '@shiftpane/board'
import type { Tone } from '@shiftpane/protocol'
import { Icon } from '@shiftpane/ui/icons'
import { type Accent, accents, type WidgetSize, widgetSizes } from '@shiftpane/widget-sdk'
import { type CSSProperties, useEffect, useState } from 'react'
import {
  type Block,
  buildView,
  MAX_BLOCKS,
  type MetricId,
  metricIds,
  metrics,
  newRecipe,
  type Recipe,
  recipeSchema,
  showsFor,
  showTitles,
  sourcesOf,
} from '../../../shared/studio.ts'
import type { FolderCheck, GeneratorModels } from '../../../shared/widgets.ts'
import { Segmented } from '../layout/controls.tsx'
import { sampleFeed } from '../sampleFeed.ts'
import { Button, Card, Select } from '../shell/parts.tsx'
import { useAccount } from '../useAccount.ts'
import { useSettings } from '../useSettings.ts'

/** The draft's id in the sample feed, so the previews draw it like an installed widget. */
const DRAFT_ID = 'studio-draft'
/** One board cell in the preview: big enough that the 2 × 2 card is drawn as a large one. */
const CELL = 160
const GAP = 12

const FIELD =
  'h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-border-strong'

const SWATCH: Record<Accent, string> = {
  flame: 'var(--color-flame)',
  lime: 'var(--color-lime)',
  mint: 'var(--color-mint)',
  sky: 'var(--color-sky)',
  ink: 'var(--color-ink)',
}

const SIZE_NAMES: Record<WidgetSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' }

/**
 * Widget Studio: a widget made without code. Pick PC readings and how each is shown, or describe
 * it and let a local model pick, and the phone's own cards preview every size as you go. Saving
 * writes an ordinary widget folder and installs it after the usual permission prompt.
 */
export function StudioPage({
  editId,
  data,
  onBack,
  onSaved,
}: {
  /** A widget Studio made, to edit; null for a new one. */
  editId: string | null
  data: PcData
  onBack: () => void
  onSaved: (check: Exclude<FolderCheck, { status: 'canceled' }>) => void
}) {
  const account = useAccount()
  const [recipe, setRecipe] = useState<Recipe>(newRecipe)
  const [author, setAuthor] = useState('')
  const [tone, setTone] = useState<Tone>('dark')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editId) return
    void window.shiftpane.studio.get(editId).then((saved) => {
      if (!saved) return
      setRecipe(saved.recipe)
      setAuthor(saved.author === 'me' ? '' : saved.author)
    })
  }, [editId])

  // The draft goes to the sample feed, so its cards tick with the sample PC like the others.
  useEffect(() => {
    sampleFeed.showDrafts([
      {
        id: DRAFT_ID,
        name: recipe.name || 'Widget',
        version: '0.0.0',
        sizes: recipe.sizes,
        actions: [],
        view: buildView(recipe),
        sample: {},
        config: {},
        sources: sourcesOf(recipe),
      },
    ])
  }, [recipe])
  useEffect(() => () => sampleFeed.showDrafts([]), [])

  const login = author || (account.status === 'signed-in' ? account.login : '')
  const ready = recipeSchema.safeParse(recipe).success
  const save = async () => {
    setSaving(true)
    const result = await window.shiftpane.studio.save(recipe, editId, login)
    setSaving(false)
    if (result.status !== 'canceled') onSaved(result)
  }

  const setBlock = (index: number, block: Block | null) =>
    setRecipe((current) => ({
      ...current,
      blocks:
        block === null
          ? current.blocks.filter((_, at) => at !== index)
          : current.blocks.map((old, at) => (at === index ? block : old)),
    }))
  const moveBlock = (index: number, by: -1 | 1) =>
    setRecipe((current) => {
      const blocks = [...current.blocks]
      const [moved] = blocks.splice(index, 1)
      if (moved) blocks.splice(index + by, 0, moved)
      return { ...current, blocks }
    })
  const toggleSize = (size: WidgetSize) =>
    setRecipe((current) => {
      const sizes = current.sizes.includes(size)
        ? current.sizes.filter((other) => other !== size)
        : widgetSizes.filter((other) => other === size || current.sizes.includes(other))
      return sizes.length > 0 ? { ...current, sizes } : current
    })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button icon="chevron-left" onClick={onBack}>
          Widgets
        </Button>
        <h2 className="font-medium">{editId ? `Editing ${recipe.name}` : 'Widget Studio'}</h2>
        <p className="text-ink-muted text-sm">No code: PC readings, and how each one is shown.</p>
        <Button
          tone="primary"
          size="md"
          icon="check"
          className="ml-auto"
          disabled={!ready || saving}
          onClick={() => void save()}
        >
          {editId ? 'Save and update' : 'Save and install'}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex w-[27rem] shrink-0 flex-col gap-4 overflow-y-auto [scrollbar-width:thin]">
          <Describe onRecipe={setRecipe} />

          <Card title="Widget" icon="widgets" className="shrink-0">
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-ink-soft text-xs">Name</span>
                <input
                  className={FIELD}
                  value={recipe.name}
                  maxLength={48}
                  onChange={(event) => setRecipe({ ...recipe, name: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-ink-soft text-xs">Description</span>
                <input
                  className={FIELD}
                  value={recipe.description ?? ''}
                  maxLength={280}
                  placeholder="Says what it shows, from its blocks, when left empty"
                  onChange={(event) =>
                    setRecipe({ ...recipe, description: event.target.value || undefined })
                  }
                />
              </label>
              <div>
                <span className="mb-1.5 block text-ink-soft text-xs">Sizes</span>
                <div className="flex gap-1.5">
                  {widgetSizes.map((size) => (
                    <button
                      key={size}
                      type="button"
                      aria-pressed={recipe.sizes.includes(size)}
                      onClick={() => toggleSize(size)}
                      className="rounded-lg border border-border px-3 py-1.5 font-medium text-ink-muted text-xs transition hover:text-ink aria-pressed:border-border-strong aria-pressed:bg-surface-raised aria-pressed:text-ink"
                    >
                      {SIZE_NAMES[size]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-ink-soft text-xs">
                  Author <span className="text-ink-faint">(your GitHub login, to share it)</span>
                </span>
                <input
                  className={FIELD}
                  value={author}
                  maxLength={39}
                  spellCheck={false}
                  placeholder={account.status === 'signed-in' ? account.login : 'Optional'}
                  onChange={(event) => setAuthor(event.target.value.trim())}
                />
              </label>
            </div>
          </Card>

          <Card
            title="Blocks"
            icon="tables"
            className="shrink-0"
            aside={
              <span className="text-ink-muted text-xs">
                {recipe.blocks.length} of {MAX_BLOCKS}
              </span>
            }
          >
            <ol className="flex flex-col gap-3">
              {recipe.blocks.map((block, index) => (
                <BlockEditor
                  // Blocks have no id of their own; their place is what they are known by.
                  key={index}
                  block={block}
                  first={index === 0}
                  last={index === recipe.blocks.length - 1}
                  onChange={(next) => setBlock(index, next)}
                  onMove={(by) => moveBlock(index, by)}
                  onRemove={recipe.blocks.length > 1 ? () => setBlock(index, null) : undefined}
                />
              ))}
            </ol>
            {recipe.blocks.length < MAX_BLOCKS && (
              <Button
                icon="add"
                className="mt-3 self-start"
                onClick={() =>
                  setRecipe({ ...recipe, blocks: [...recipe.blocks, { show: 'cpu', as: 'value' }] })
                }
              >
                Add a block
              </Button>
            )}
            <p className="mt-3 text-ink-muted text-xs">
              The first block is the biggest. Medium and large cards add the rest beside or under
              it.
            </p>
          </Card>
        </div>

        <Card
          title="On the phone"
          icon="phone"
          className="min-w-0 flex-1"
          bodyClassName="p-0 overflow-auto [scrollbar-width:thin]"
          aside={
            <Segmented
              label="Card color"
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'black', label: 'No card' },
              ]}
              value={tone}
              onChange={setTone}
            />
          }
        >
          <div
            className="board flex min-h-full shrink-0 flex-wrap content-start items-start gap-6 bg-board p-6"
            style={{ '--cell': `${CELL}px`, '--gap': `${GAP}px` } as CSSProperties}
          >
            {widgetSizes
              .filter((size) => recipe.sizes.includes(size))
              .map((size) => (
                <figure key={size} className="flex flex-col gap-2">
                  <div
                    style={{
                      width: size === 'small' ? CELL : 2 * CELL + GAP,
                      height: size === 'large' ? 2 * CELL + GAP : CELL,
                    }}
                  >
                    <WidgetCard
                      widget={{ kind: 'installed', widget: DRAFT_ID, tone }}
                      radius={18}
                      data={data}
                      connected
                      onMediaAction={() => {}}
                    />
                  </div>
                  <figcaption className="text-white/50 text-xs">{SIZE_NAMES[size]}</figcaption>
                </figure>
              ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function BlockEditor({
  block,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  block: Block
  first: boolean
  last: boolean
  onChange: (block: Block) => void
  onMove: (by: -1 | 1) => void
  onRemove?: () => void
}) {
  const ways = showsFor(block.show)
  const pick = (show: MetricId) =>
    onChange({
      ...block,
      show,
      as: showsFor(show).includes(block.as) ? block.as : (showsFor(show)[0] ?? 'value'),
    })
  const iconButton =
    'grid size-7 place-items-center rounded-md text-ink-muted transition hover:bg-surface-raised hover:text-ink disabled:opacity-30'
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2.5">
      <div className="flex gap-2">
        <Select
          aria-label="Reading"
          className="flex-1"
          value={block.show}
          onChange={(event) => pick(event.target.value as MetricId)}
        >
          {metricIds.map((id) => (
            <option key={id} value={id}>
              {metrics[id].title}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Shown as"
          className="w-36"
          value={block.as}
          onChange={(event) => onChange({ ...block, as: event.target.value as Block['as'] })}
        >
          {ways.map((way) => (
            <option key={way} value={way}>
              {showTitles[way]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <input
          className={`${FIELD} h-8 flex-1 text-xs`}
          aria-label="Label"
          value={block.label ?? ''}
          maxLength={24}
          placeholder={`Label: ${metrics[block.show].label}`}
          onChange={(event) => onChange({ ...block, label: event.target.value || undefined })}
        />
        <fieldset aria-label="Color" className="flex items-center gap-1">
          <button
            type="button"
            aria-label="No color"
            aria-pressed={!block.color}
            onClick={() => onChange({ ...block, color: undefined })}
            className="size-5 rounded-full border border-border-strong bg-surface-sunken aria-pressed:ring-2 aria-pressed:ring-ink/70"
          />
          {accents.map((accent) => (
            <button
              key={accent}
              type="button"
              aria-label={accent}
              aria-pressed={block.color === accent}
              onClick={() => onChange({ ...block, color: accent })}
              className="size-5 rounded-full aria-pressed:ring-2 aria-pressed:ring-ink/70"
              style={{ background: SWATCH[accent] }}
            />
          ))}
        </fieldset>
        <span className="ml-1 flex">
          <button
            type="button"
            aria-label="Move up"
            title="Move up"
            disabled={first}
            onClick={() => onMove(-1)}
            className={iconButton}
          >
            <Icon name="chevron-up" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Move down"
            title="Move down"
            disabled={last}
            onClick={() => onMove(1)}
            className={iconButton}
          >
            <Icon name="chevron-down" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Remove"
            title="Remove"
            disabled={!onRemove}
            onClick={onRemove}
            className={iconButton}
          >
            <Icon name="trash" className="size-4" />
          </button>
        </span>
      </div>
    </li>
  )
}

/** Describing the widget instead: a local model writes the recipe, which then opens here. */
function Describe({ onRecipe }: { onRecipe: (recipe: Recipe) => void }) {
  const [settings, setSettings] = useSettings()
  const [models, setModels] = useState<GeneratorModels | null>(null)
  const [prompt, setPrompt] = useState('')
  const [started, setStarted] = useState<number | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  const look = () => {
    setModels(null)
    void window.shiftpane.generator.models().then(setModels)
  }
  useEffect(look, [])
  useEffect(() => {
    if (started === null) return
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 500)
    return () => clearInterval(timer)
  }, [started])

  const available = models?.ok ? models.models : []
  const model =
    settings.generatorModel && available.includes(settings.generatorModel)
      ? settings.generatorModel
      : models?.ok
        ? models.preferred
        : null

  const make = async () => {
    if (!model) return
    setProblem(null)
    setSeconds(0)
    setStarted(Date.now())
    const result = await window.shiftpane.generator.run(prompt, model)
    setStarted(null)
    if (result.ok) onRecipe(result.recipe)
    else setProblem(result.problem)
  }

  return (
    <Card
      className="shrink-0"
      title="Describe it"
      icon="bolt"
      aside={<span className="text-ink-muted text-xs">Runs on this PC</span>}
    >
      <textarea
        className={`${FIELD} h-20 resize-none py-2 leading-snug`}
        placeholder="My CPU and GPU as two rings, with the download speed underneath"
        value={prompt}
        maxLength={400}
        disabled={started !== null}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void make()
        }}
      />
      {models?.ok === false ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-ink-muted text-xs">{models.problem}</p>
          <div className="flex gap-2">
            <Button icon="refresh" onClick={look}>
              Check again
            </Button>
            <Button
              icon="external"
              onClick={() => window.open('https://ollama.com/download', '_blank')}
            >
              Get Ollama
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <Select
            aria-label="Model"
            className="min-w-0 flex-1"
            value={model ?? ''}
            disabled={!models || started !== null}
            onChange={(event) => setSettings({ generatorModel: event.target.value })}
          >
            {!models && <option value="">Looking for models…</option>}
            {available.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          {started === null ? (
            <Button tone="primary" disabled={!model || !prompt.trim()} onClick={() => void make()}>
              Make it
            </Button>
          ) : (
            <Button onClick={() => void window.shiftpane.generator.cancel()}>
              Stop · {seconds} s
            </Button>
          )}
        </div>
      )}
      {started !== null && (
        <p className="mt-2 text-ink-muted text-xs">
          {seconds < 20
            ? 'Writing the widget…'
            : 'Still going: the first answer loads the model, which takes longer.'}
        </p>
      )}
      {problem && <p className="mt-2 text-warn text-xs">{problem}</p>}
      <p className="mt-3 text-ink-faint text-xs">
        An open-weights model in Ollama writes it; nothing leaves this PC. It replaces the widget
        below, so describe the whole thing.
      </p>
    </Card>
  )
}
