import { useEffect, useRef, useState } from 'react'
import Bar from './Bar.jsx'
import {
  offlineMode, getReview, resolveReview, retryReview, reviewerId, updateCaseWorkflow,
} from './api.js'

const TITLE = {
  MISSING_ATTACHMENT: 'Nothing attached to check',
  UNREADABLE_DOCUMENT: 'The file will not open',
  WRONG_DOC_TYPE: 'Wrong document attached',
  FIELD_NOT_FOUND: 'A value is blank',
  GROUNDING_FAILED: 'The evidence could not be found',
  LOW_CONFIDENCE: 'The two values are almost the same',
  BORDERLINE_MATCH: 'The two values are almost the same',
  PROCESSING_ERROR: 'Something went wrong reading this',
  MANUAL_REVIEW_REQUESTED: 'A teammate asked for a second check',
}

// The outbound request each reason calls for. Only these may be recorded in
// bulk: they ask the sender for something and change nothing on the case.
const REQUEST = {
  MISSING_ATTACHMENT: 'Ask for the draft',
  UNREADABLE_DOCUMENT: 'Ask for a text copy',
  WRONG_DOC_TYPE: 'Ask for the right file',
  FIELD_NOT_FOUND: 'Ask to complete the instruction',
}

const ORDER = ['WRONG_DOC_TYPE', 'MISSING_ATTACHMENT', 'UNREADABLE_DOCUMENT', 'PROCESSING_ERROR',
  'FIELD_NOT_FOUND', 'GROUNDING_FAILED', 'LOW_CONFIDENCE', 'BORDERLINE_MATCH', 'MANUAL_REVIEW_REQUESTED']

export default function Review() {
  const [items, setItems] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [pending, setPending] = useState(new Set())
  const [selectedId, setSelectedId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [correction, setCorrection] = useState(null)
  const [history, setHistory] = useState({})
  const detailRef = useRef(null)
  const listRef = useRef(null)

  function load() {
    setItems(null)
    setLoadError(null)
    getReview().then(d => setItems(d.items)).catch(e => setLoadError(e.message))
  }

  useEffect(() => { load() }, [])

  const ordered = [...(items || [])].sort((a, b) =>
    ORDER.indexOf(a.reason) - ORDER.indexOf(b.reason)
    || new Date(a.created_at || 0) - new Date(b.created_at || 0)
    || a.email_id.localeCompare(b.email_id, undefined, { numeric: true }))
  const selected = ordered.find(item => item.id === selectedId) || ordered[0] || null

  function remember(id, text) {
    setHistory(h => ({ ...h, [id]: [...(h[id] || []), { at: new Date().toISOString(), text }] }))
  }

  function busy(id, on) {
    setPending(current => {
      const next = new Set(current)
      if (on) next.add(id); else next.delete(id)
      return next
    })
  }

  function selectNextAfter(id) {
    const index = ordered.findIndex(item => item.id === id)
    const next = ordered[index + 1] || ordered[index - 1] || null
    setSelectedId(next ? next.id : null)
    window.requestAnimationFrame(() => detailRef.current?.focus())
  }

  async function resolve(item, word, details = {}) {
    busy(item.id, true)
    setNotice(null)
    try {
      await resolveReview(item.id, {
        action: details.correctValue != null ? 'correct' : 'confirm',
        field: item.fields[0] ?? null,
        correct_value: details.correctValue ?? null,
        document_role: details.documentRole ?? 'BL',
        reviewer_id: reviewerId,
      })
      remember(item.id, word)
      setItems(current => current.filter(i => i.id !== item.id))
      setCorrection(null)
      setConfirm(null)
      setNotice({ type: 'ok', text: `${item.email_id}: ${word.toLowerCase()} recorded.` })
      selectNextAfter(item.id)
    } catch (e) {
      setNotice({ type: 'error', text: `${item.email_id} could not be updated. ${e.message}` })
    } finally {
      busy(item.id, false)
    }
  }

  async function resolveMany(list, word) {
    setConfirm(null)
    setNotice(null)
    let done = 0
    const failed = []
    for (const item of list) {
      busy(item.id, true)
      try {
        await resolveReview(item.id, { action: 'confirm', field: item.fields[0] ?? null, correct_value: null, document_role: 'BL', reviewer_id: reviewerId })
        remember(item.id, word)
        setItems(current => current.filter(i => i.id !== item.id))
        done += 1
      } catch (e) {
        failed.push(item.email_id)
      } finally {
        busy(item.id, false)
      }
    }
    setNotice(failed.length
      ? { type: 'error', text: `${word} recorded for ${done} case${done === 1 ? '' : 's'}. Not updated: ${failed.join(', ')}.` }
      : { type: 'ok', text: `${word} recorded for ${done} case${done === 1 ? '' : 's'}.` })
    if (list.some(item => item.id === selectedId)) selectNextAfter(selectedId)
  }

  async function retry(item) {
    busy(item.id, true)
    setNotice(null)
    try {
      await retryReview(item.id)
      const fresh = await getReview()
      setItems(fresh.items)
      remember(item.id, 'Read again')
      setNotice({ type: 'ok', text: `${item.email_id} was processed again.` })
    } catch (e) {
      setNotice({ type: 'error', text: e.message })
    } finally {
      busy(item.id, false)
    }
  }

  async function assign(item) {
    busy(item.id, true)
    setNotice(null)
    try {
      await updateCaseWorkflow(item.email_id, { assigned_to: reviewerId, review_status: 'assigned' })
      setItems(current => current.map(value => value.id === item.id
        ? { ...value, assigned_to: reviewerId, review_status: 'assigned' }
        : value))
      remember(item.id, `Assigned to ${reviewerId}`)
    } catch (e) {
      setNotice({ type: 'error', text: e.message })
    } finally {
      busy(item.id, false)
    }
  }

  function onListKey(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = ordered.findIndex(item => item.id === selected?.id)
    let next = index
    if (event.key === 'ArrowDown') next = Math.min(ordered.length - 1, index + 1)
    if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = ordered.length - 1
    const item = ordered[next]
    if (!item) return
    setSelectedId(item.id)
    listRef.current?.querySelector(`[data-id="${item.id}"]`)?.focus()
  }

  if (loadError) return (
    <Shell meta="review queue">
      <div className="state state--error">
        <b>Could not reach the review service.</b>
        <span>{loadError}</span>
        <button className="btn btn--ghost btn--small" type="button" onClick={load}>Try again</button>
      </div>
    </Shell>
  )
  if (!items) return <Shell meta="review queue"><div className="state">Reading the queue.</div></Shell>

  const groups = []
  for (const item of ordered) {
    const last = groups[groups.length - 1]
    if (last && last.reason === item.reason) last.items.push(item)
    else groups.push({ reason: item.reason, items: [item] })
  }

  return (
    <Shell meta={ordered.length + ' open'}>
      <div className="rmain">
        <div className="reviewhead">
          <span className="eyebrow">Review queue</span>
          <h1>{ordered.length === 0 ? 'The queue is clear.' : `${ordered.length} case${ordered.length === 1 ? '' : 's'} waiting for a person`}</h1>
          <p>The system stopped instead of guessing. Each case shows what it saw and what it needs from you.</p>
        </div>

        {notice && <div className={'reviewnotice' + (notice.type === 'error' ? ' reviewnotice--error' : '')} role="status">{notice.text}</div>}

        {ordered.length === 0 ? (
          <div className="empty">
            <b>Nothing is waiting on a person.</b>
            <span>Cases the system cannot decide appear here, with the reason and the evidence.</span>
            <a className="btn btn--ghost btn--small" href="#/">Open the worklist</a>
          </div>
        ) : (
          <div className="queue">
            <aside className="queue__list" aria-label="Cases held for review" ref={listRef} onKeyDown={onListKey}>
              {groups.map(group => (
                <section className="queue__group" key={group.reason} aria-label={TITLE[group.reason] || group.reason}>
                  <h3>
                    <span className="mk mk--review" aria-hidden="true"></span>
                    {TITLE[group.reason] || 'Held for review'}
                    <span className="queue__count">{group.items.length}</span>
                    {REQUEST[group.reason] && group.items.length > 1 && (
                      <button
                        className="queue__bulk"
                        type="button"
                        onClick={() => setConfirm({ items: group.items, word: REQUEST[group.reason] })}
                      >
                        {REQUEST[group.reason]}, all {group.items.length}
                      </button>
                    )}
                  </h3>
                  <ol>
                    {group.items.map(item => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="qrow"
                          data-id={item.id}
                          aria-current={selected?.id === item.id ? 'true' : undefined}
                          tabIndex={selected?.id === item.id ? 0 : -1}
                          onClick={() => { setSelectedId(item.id); setConfirm(null); setCorrection(null) }}
                        >
                          <span className="qrow__id">{item.email_id}</span>
                          <span className="qrow__meta">{item.assigned_to || 'Unassigned'} · {age(item.created_at)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </aside>

            <section className="queue__detail" aria-label="Selected case">
              {confirm && (
                <div className="queue__confirm" role="group" aria-label="Confirm">
                  <b>
                    {confirm.items
                      ? `${confirm.word} for ${confirm.items.length} cases?`
                      : `${confirm.word} for ${confirm.item.email_id}?`}
                  </b>
                  <span>
                    {confirm.items
                      ? 'Each case is marked handled and the request is recorded in its audit trail. No email is sent.'
                      : confirm.detail}
                  </span>
                  <div className="queue__confirmactions">
                    <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirm(null)}>Cancel</button>
                    <button
                      className="btn btn--small"
                      type="button"
                      disabled={pending.size > 0}
                      onClick={() => confirm.items ? resolveMany(confirm.items, confirm.word) : resolve(confirm.item, confirm.word, confirm.details)}
                    >
                      {confirm.items ? `Confirm for all ${confirm.items.length}` : 'Confirm and next'}
                    </button>
                  </div>
                </div>
              )}

              {selected && (
                <Detail
                  item={selected}
                  pending={pending.has(selected.id)}
                  history={history[selected.id] || []}
                  headingRef={detailRef}
                  correction={correction?.id === selected.id ? correction : null}
                  onCorrection={setCorrection}
                  onAssign={() => assign(selected)}
                  onRetry={() => retry(selected)}
                  onRequest={() => setConfirm({
                    item: selected,
                    word: REQUEST[selected.reason] || 'Confirm and close',
                    detail: REQUEST[selected.reason]
                      ? 'This marks the case handled and records the request in the audit trail. It does not email the sender.'
                      : 'This marks the case handled and records your confirmation in the audit trail.',
                  })}
                  onConfirm={() => setConfirm({
                    item: selected,
                    word: 'Confirm and close',
                    detail: 'This closes the review item and records your confirmation in the audit trail.',
                  })}
                  onCorrect={() => resolve(selected, 'Value corrected', { correctValue: correction.value.trim(), documentRole: correction.role })}
                />
              )}
            </section>
          </div>
        )}
      </div>
    </Shell>
  )
}

function Detail({ item, pending, history, headingRef, correction, onCorrection, onAssign, onRetry, onRequest, onConfirm, onCorrect }) {
  const request = REQUEST[item.reason]
  const hasEvidence = item.si_value || item.bl_value
  return (
    <article className="qdetail" aria-busy={pending}>
      <div className="qdetail__top">
        <span className="card__ref">{item.email_id}</span>
        <span className={'priority priority--' + reviewPriority(item).key}>{reviewPriority(item).label}</span>
      </div>
      <h2 className="qdetail__title" tabIndex="-1" ref={headingRef}>{TITLE[item.reason] ?? 'Held for review'}</h2>
      <p className="qdetail__why">{sentence(item.reason_detail)}</p>

      <dl className="qdetail__facts">
        <div><dt>Owner</dt><dd>{item.assigned_to || 'Unassigned'}</dd></div>
        <div><dt>Status</dt><dd>{workflowWord(item.review_status)}</dd></div>
        <div><dt>Waiting</dt><dd>{age(item.created_at)}</dd></div>
        {item.fields?.length > 0 && <div><dt>Fields</dt><dd>{item.fields.join(', ')}</dd></div>}
      </dl>

      {hasEvidence && (
        <div className="card__evidence">
          <div><em>Instruction</em><span>{item.si_value ?? '—'}</span></div>
          <div><em>Draft</em><span>{item.bl_value ?? '—'}</span></div>
        </div>
      )}

      {correction && (
        <form
          className="card__correction"
          onSubmit={event => { event.preventDefault(); onCorrect() }}
        >
          <label>
            <span>Correct which document?</span>
            <select value={correction.role} onChange={event => onCorrection({ ...correction, role: event.target.value })}>
              <option value="BL">Draft bill of lading</option>
              <option value="SI">Shipping instruction</option>
            </select>
          </label>
          <label>
            <span>Correct value</span>
            <input
              value={correction.value}
              onChange={event => onCorrection({ ...correction, value: event.target.value })}
              placeholder="Enter the value shown in the document"
              required
              autoFocus
            />
          </label>
          <p>The source extraction stays unchanged. This value rejoins at comparison and is recorded in the audit log.</p>
          <div className="card__actions">
            <button className="btn btn--small" type="submit" disabled={!correction.value.trim() || pending}>Save and compare again</button>
            <button className="btn btn--ghost btn--small" type="button" onClick={() => onCorrection(null)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="qdetail__actions">
        <button className="btn btn--small" type="button" disabled={pending} onClick={request ? onRequest : onConfirm}>
          {request || 'Confirm and close'}
        </button>
        <a className="btn btn--ghost btn--small" href={'#/case/' + item.email_id}>Open the case</a>
        {!item.assigned_to && (
          <button className="btn btn--ghost btn--small" type="button" disabled={pending} onClick={onAssign}>Assign to me</button>
        )}
        {!offlineMode && retryable(item.reason) && (
          <button className="btn btn--ghost btn--small" type="button" disabled={pending} onClick={onRetry}>Read it again</button>
        )}
        {!offlineMode && item.fields?.length > 0 && !correction && (
          <button className="btn btn--ghost btn--small" type="button" onClick={() => onCorrection({ id: item.id, role: 'BL', value: item.bl_value ?? '' })}>
            Correct a value
          </button>
        )}
        {request && (
          <button className="btn btn--ghost btn--small" type="button" disabled={pending} onClick={onConfirm}>Confirm and close</button>
        )}
      </div>

      <div className="qdetail__log">
        <span className="eyebrow">Activity</span>
        <ol>
          <li><time dateTime={item.created_at}>{clock(item.created_at)}</time>Held by the system</li>
          {item.assigned_to && <li><time></time>Assigned to {item.assigned_to}</li>}
          {history.map((entry, i) => <li key={i}><time dateTime={entry.at}>{clock(entry.at)}</time>{entry.text}, by {reviewerId}</li>)}
        </ol>
      </div>
    </article>
  )
}

function retryable(reason) {
  return ['UNREADABLE_DOCUMENT', 'GROUNDING_FAILED', 'PROCESSING_ERROR'].includes(reason)
}

function reviewPriority(item) {
  if (['MISSING_ATTACHMENT', 'UNREADABLE_DOCUMENT', 'WRONG_DOC_TYPE', 'PROCESSING_ERROR'].includes(item.reason)) {
    return { key: 'urgent', label: 'Blocked' }
  }
  return { key: 'high', label: 'High' }
}

function workflowWord(value) {
  return {
    unassigned: 'Unassigned',
    assigned: 'Assigned',
    in_progress: 'In progress',
    completed: 'Completed',
  }[value] || 'Unassigned'
}

function sentence(text) {
  const t = String(text || '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}

function age(iso) {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return 'time unknown'
  const hours = Math.max(0, Math.round((Date.now() - date.getTime()) / 3600000))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours} h`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

function clock(iso) {
  const date = new Date(iso)
  if (!iso || Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Shell({ meta, children }) {
  return (
    <>
      <Bar meta={meta} back="#/" title="Review queue" />
      {children}
    </>
  )
}
