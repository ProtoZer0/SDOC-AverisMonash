import { FIELD_PLAIN, REASON_TITLE, STEPS, stepOf } from './status.js'

const CATEGORY_LABEL = {
  BL_COMPARISON: 'Document comparison',
  SI_REQUEST: 'Shipping instruction',
  INVOICE_QUERY: 'Invoice question',
  GENERAL: 'General email',
  SPAM: 'Spam',
}

export default function Dashboard({ health, items, onDrillDown }) {
  const checks = items.filter(item => item.category === 'BL_COMPARISON')
  const cleared = checks.filter(item => item.status === 'OK').length
  const mismatches = checks.filter(item => item.status === 'MISMATCH').length
  const held = checks.filter(item => item.status === 'NEEDS_REVIEW').length
  const routed = items.length - checks.length
  const todo = items.filter(isTodo)

  const leftToDo = STEPS
    .filter(step => !['cleared', 'other'].includes(step.key))
    .map(step => ({ key: step.key, label: step.label, mk: step.mk, value: todo.filter(item => stepOf(item).key === step.key).length }))
    .filter(row => row.value > 0)
  const defectFields = countRows(checks.flatMap(item => item.defect_fields || []), value => value, FIELD_PLAIN)
  const reasons = countRows(checks.filter(item => item.status === 'NEEDS_REVIEW'), item => item.wire_review_reason, REASON_TITLE)
  const workload = countRows(items, item => item.category, CATEGORY_LABEL)
  const days = byDay(items)

  return (
    <div className="ops">
      <section className="funnel" aria-labelledby="funnel-title">
        <span className="eyebrow">Taken off the desk</span>
        <h2 id="funnel-title">
          {checks.length === 0
            ? 'No document checks yet.'
            : <><b>{cleared} of {checks.length}</b> drafts cleared without a person. {held} held for review, {mismatches} sent back.</>}
        </h2>
        <div className="funnel__row">
          <button type="button" className="funnel__box" onClick={() => onDrillDown?.({ kind: 'none' })}>
            <small>Emails read</small><strong>{items.length}</strong><span>{routed} were not checks</span>
          </button>
          <span className="funnel__arrow" aria-hidden="true"></span>
          <button type="button" className="funnel__box" onClick={() => onDrillDown?.({ kind: 'category', value: 'BL_COMPARISON' })}>
            <small>Document checks</small><strong>{checks.length}</strong><span>{percent(checks.length, items.length)} of email</span>
          </button>
          <span className="funnel__arrow" aria-hidden="true"></span>
          <div className="funnel__outcomes">
            <Outcome mk="clear" label="Cleared" value={cleared} total={checks.length} onClick={() => onDrillDown?.({ kind: 'result', value: 'clear' })} />
            <Outcome mk="wrong" label="Differences found" value={mismatches} total={checks.length} onClick={() => onDrillDown?.({ kind: 'result', value: 'wrong' })} />
            <Outcome mk="review" label="Held for review" value={held} total={checks.length} onClick={() => onDrillDown?.({ kind: 'result', value: 'review' })} />
          </div>
        </div>
      </section>

      <div className="qgrid">
        <Chart
          eyebrow="Left to do"
          title={leftToDo.length ? `${todo.filter(i => stepOf(i).key !== 'cleared' && stepOf(i).key !== 'other').length} cases need something sent` : 'Nothing is waiting'}
          rows={leftToDo}
          tone="mixed"
          empty="Every case that needed a reply has one."
          onSelect={key => onDrillDown?.({ kind: 'step', value: key, view: 'todo' })}
        />
        <Chart
          eyebrow="What goes wrong in drafts"
          title={defectFields.length ? `${defectFields[0].label} is the most common difference` : 'No differences recorded'}
          rows={defectFields}
          tone="wrong"
          total={mismatches}
          empty="No draft has disagreed with its instruction."
          onSelect={key => onDrillDown?.({ kind: 'field', value: key })}
        />
        <Chart
          eyebrow="Why the system stops"
          title={reasons.length ? `${reasons[0].label} is the usual reason` : 'The system has not needed to stop'}
          rows={reasons}
          tone="review"
          total={held}
          empty="Nothing has been held for review."
          onSelect={key => onDrillDown?.({ kind: 'reason', value: key })}
        />
        {days
          ? <Chart eyebrow="Arrivals by day" title={`${days.length} days with email`} rows={days} tone="neutral" empty="No dated email." />
          : <Chart
              eyebrow="What arrives"
              title={workload.length ? `${workload[0].label} is most of the inbox` : 'Nothing has arrived'}
              rows={workload}
              tone="neutral"
              total={items.length}
              empty="The inbox is empty."
              onSelect={key => onDrillDown?.({ kind: 'category', value: key })}
            />}
      </div>

      <p className={'healthline healthline--' + healthTone(health)} role="status">
        <i aria-hidden="true"></i>{healthWord(health)}
      </p>
    </div>
  )
}

function Outcome({ mk, label, value, total, onClick }) {
  return (
    <button type="button" className={'funnel__outcome funnel__outcome--' + mk} onClick={onClick}>
      <span className={'mk mk--' + mk} aria-hidden="true"></span>
      <span className="funnel__word">{label}</span>
      <strong>{value}</strong>
      <small>{percent(value, total)}</small>
    </button>
  )
}

function Chart({ eyebrow, title, rows, tone, total, empty, onSelect }) {
  const largest = Math.max(0, ...rows.map(row => row.value))
  const scale = total > 0 ? total : largest
  return (
    <section className="chartpanel">
      <header className="chartpanel__head">
        <span className="eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
      </header>
      {rows.length > 0
        ? <ol className="chartbars" aria-label={`${eyebrow}: ${rows.map(row => `${row.label} ${row.value}`).join(', ')}`}>
            {rows.map(row => (
              <li key={row.key ?? row.label}>
                <button className="chartbars__button" type="button" disabled={!onSelect} onClick={() => onSelect?.(row.key)}>
                  <span className="chartbars__label">
                    {row.mk && <span className={'mk mk--' + row.mk} aria-hidden="true"></span>}
                    <span className="chartbars__text">{row.label}</span>
                    <span className="chartbars__value">
                      <b>{row.value}</b>
                      {total > 0 && <small>{percent(row.value, total)}</small>}
                    </span>
                  </span>
                  <span className="chartbars__track" aria-hidden="true">
                    <i
                      className={'chartbars__fill chartbars__fill--' + (tone === 'mixed' ? row.mk : tone)}
                      style={{ width: `${scale > 0 ? Math.max(3, row.value / scale * 100) : 0}%` }}
                    ></i>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        : <p className="chartpanel__empty">{empty}</p>}
    </section>
  )
}

function isTodo(item) {
  if (['resolved', 'archived'].includes(item.lifecycle) || item.review_status === 'completed') return false
  return !item.lifecycle || item.lifecycle === 'new' || item.lifecycle === 'in_review'
}

function countRows(items, getKey, labels) {
  const counts = new Map()
  for (const item of items) {
    const key = getKey(item)
    if (labels[key]) counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts]
    .map(([key, value]) => ({ key, label: labels[key], value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

// Only when the inbox carries real dates on more than one day; a single
// synthetic date would draw one bar and imply a trend that is not there.
function byDay(items) {
  const counts = new Map()
  for (const item of items) {
    const value = item.received_at
    if (!value) continue
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) continue
    const key = date.toISOString().slice(0, 10)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  if (counts.size < 2) return null
  return [...counts]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14)
    .map(([key, value]) => ({ key, label: new Date(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), value }))
}

function percent(value, total) {
  return total > 0 ? `${(value / total * 100).toFixed(value === total ? 0 : 1)}%` : '0%'
}

function healthTone(health) {
  if (!health) return 'unknown'
  if (health.circuit_breaker === 'open') return 'wrong'
  if (health.mode === 'deterministic_only') return 'fallback'
  return 'online'
}

function healthWord(health) {
  if (!health) return 'Sample data. The live service is not connected, so these figures come from the bundled fixtures.'
  if (health.circuit_breaker === 'open') return `Circuit open. AI services paused after ${health.ai_failures} repeated failures; deterministic checks still run.`
  if (health.mode === 'deterministic_only') return 'Deterministic-only mode. AI fallback is paused; parsers and rules are running.'
  return 'All services online.'
}

