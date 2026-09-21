import { useEffect, useState } from 'react'
import Bar from './Bar.jsx'
import Pages, { buildHits } from './Pages.jsx'
import AuditTrail from './AuditTrail.jsx'
import CaseReport from './CaseReport.jsx'
import {
  clearCaseDecision, getAuditEvents, getCase, getCaseDecision, getDocument, recordCaseDecision,
  reviewerId, updateCaseWorkflow,
} from './api.js'
import { KIND_WORD, kindOf, stepOf } from './status.js'

export default function CaseView({ id, field }) {
  const [kase, setCase] = useState(null)
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [selectedField, setSelectedField] = useState(null)
  const [events, setEvents] = useState(null)

  async function refreshCase() {
    const nextCase = await getCase(id)
    const wants = role => nextCase.category === 'BL_COMPARISON' && nextCase.documents.some(d => d.role === role)
    const [nextEvents, si, bl] = await Promise.all([
      getAuditEvents(id).catch(() => ({ items: [] })),
      wants('SI') ? getDocument(id, 'SI').catch(() => null) : null,
      wants('BL') ? getDocument(id, 'BL').catch(() => null) : null,
    ])
    setCase(nextCase)
    setDocs({ SI: si, BL: bl })
    setEvents(nextEvents.items)
  }

  useEffect(() => {
    setCase(null)
    setDocs(null)
    setError(null)
    setAuditOpen(false)
    setSelectedField(field || null)
    setEvents(null)
    refreshCase().catch(e => setError(e.message))
  }, [id])

  if (error) return <Frame meta={id}><div className="state">Could not open {id}. {error}</div></Frame>
  if (!kase) return <Frame meta={id}><div className="state">Opening {id}.</div></Frame>

  let content
  if (kase.category !== 'BL_COMPARISON') content = <NotACheck kase={kase} />
  else if (kase.documents.length === 0 && kase.status === 'OK') content = <NothingToCompare kase={kase} />
  else content = <Check kase={kase} docs={docs} selected={selectedField} onSelect={setSelectedField} />

  const canShowEvidence = kase.category === 'BL_COMPARISON' && kase.comparisons.length > 0

  return (
    <Frame
      meta={id}
      kase={kase}
      auditOpen={auditOpen}
      onAudit={() => setAuditOpen(!auditOpen)}
      onCloseAudit={() => setAuditOpen(false)}
      onViewEvidence={canShowEvidence ? field => { setSelectedField(field); setAuditOpen(false) } : null}
      events={events}
    >
      {content}
      <Actions kase={kase} onChanged={refreshCase} />
      <WorkflowPanel kase={kase} onChanged={refreshCase} />
    </Frame>
  )
}

function Frame({ meta, kase, events, auditOpen, onAudit, onCloseAudit, onViewEvidence, children }) {
  const action = kase && (
    <button
      className="thin__audit"
      type="button"
      aria-expanded={auditOpen}
      aria-controls="case-audit"
      onClick={onAudit}
    >
      <span className="thin__auditmark" aria-hidden="true"></span>
      <span className="thin__action-label">Audit trail</span>
    </button>
  )
  return (
    <>
      <Bar meta={meta} back="#/" action={action} title="Document check" />
      {kase && <CaseBanner kase={kase} />}
      {children}
      {kase && <CaseReport kase={kase} events={events} />}
      {auditOpen && (
        <AuditTrail kase={kase} onClose={onCloseAudit} onViewEvidence={onViewEvidence} />
      )}
    </>
  )
}

function CaseBanner({ kase }) {
  const kind = kindOf(kase)
  return (
    <section className="casebanner" aria-labelledby="case-title">
      <span className={'mk mk--' + kind} aria-hidden="true"></span>
      <div className="casebanner__body">
        <span className={'casebanner__status casebanner__status--' + kind}>{KIND_WORD[kind]}</span>
        <h1 id="case-title">{kase.subject || kase.email_id}</h1>
      </div>
      <dl className="casebanner__meta">
        <div><dt>Case</dt><dd>{kase.email_id}</dd></div>
        <div><dt>From</dt><dd>{kase.from_addr || 'not recorded'}</dd></div>
      </dl>
    </section>
  )
}

function NotACheck({ kase }) {
  return (
    <div className="panel">
      <div className="card">
        <span className="card__title">{kase.subject}</span>
        <p className="card__body">{kase.summary}</p>
        <div className="card__evidence">
          <div><em>From</em><span>{kase.from_addr}</span></div>
          <div><em>Sorted as</em><span>{kase.category.toLowerCase().replace(/_/g, ' ')}</span></div>
        </div>
      </div>
    </div>
  )
}

function NothingToCompare({ kase }) {
  return (
    <div className="panel">
      <div className="card">
        <span className="card__title">Nothing to compare</span>
        <p className="card__body">{kase.summary}</p>
        <div className="card__evidence">
          <div><em>From</em><span>{kase.from_addr}</span></div>
          <div><em>Attachments</em><span>{kase.documents.length}</span></div>
        </div>
      </div>
    </div>
  )
}

function Check({ kase, docs, selected, onSelect }) {
  const hits = buildHits(kase, docs?.SI?.text, docs?.BL?.text)
  const wrong = hits.filter(h => h.kind === 'wrong')
  const review = hits.filter(h => h.kind === 'review')
  const clear = hits.filter(h => h.kind === 'clear').length
  const notes = kase.comparisons.length > 0 ? [...wrong, ...review] : []
  const pick = field => onSelect(selected === field ? null : field)

  return (
    <div className="casemain">
      <div className="pageshead">
        <Headline kase={kase} docs={docs} wrong={wrong.length} review={review.length} clear={clear} />
      </div>
      <Pages kase={kase} docs={docs} selected={selected} onSelect={onSelect} />
      {notes.length > 0 && (
        <div className="corrections">
          {notes.map((h, i) => (
            <article className={'corr' + (h.kind === 'review' ? ' corr--review' : '')} key={h.field} data-on={selected === h.field}>
              <span className="corr__k">
                <span className={'mk mk--' + h.kind} aria-hidden="true"></span>
                {h.kind === 'wrong' ? `Correction ${i + 1}` : 'Not checked'} · {h.name}
              </span>
              <span className="corr__t">
                {h.kind === 'wrong' ? `${h.name} differs from the instruction.` : whyNotChecked(h.comparison)}
              </span>
              <Labels comparison={h.comparison} />
              {(h.SI || h.BL) && (
                <button className="corr__src" type="button" onClick={() => pick(h.field)}>
                  {selected === h.field ? 'Clear the highlight' : (h.SI && h.BL ? 'Show on both pages' : 'Show on the page')}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function Headline({ kase, docs, wrong, review, clear }) {
  if (kase.comparisons.length === 0) {
    const si = kase.documents.find(d => d.role === 'SI')
    const read = si?.fields ? Object.values(si.fields).filter(f => f && f.value).length : 0
    return (
      <>
        <h2><b className="review">Stopped</b> before comparing. {stopSentence(kase)}</h2>
        {docs?.SI?.text && <p>{read} of 7 instruction values were read. None were compared.</p>}
      </>
    )
  }
  if (wrong > 0) {
    return (
      <>
        <h2>
          <b>{wrong} correction{wrong === 1 ? '' : 's'}</b>, {clear} detail{clear === 1 ? '' : 's'} match
          {review > 0 && `, ${review} not checked`}
        </h2>
        <p>Each correction is the instruction's value, written in where the draft's value was struck.</p>
      </>
    )
  }
  if (review > 0) {
    return (
      <>
        <h2><b className="review">{review} detail{review === 1 ? '' : 's'} not checked</b>, {clear} match</h2>
        <p>A blank or unreadable value is not compared.</p>
      </>
    )
  }
  return <h2><b className="clear">All {clear} details match</b> the instruction.</h2>
}

function stopSentence(kase) {
  const bl = kase.documents.find(d => d.role === 'BL')
  const si = kase.documents.find(d => d.role === 'SI')
  switch (kase.wire_review_reason) {
    case 'unreadable': return 'The draft has no readable text.'
    case 'wrong_doc_type': return `The attachment named as the draft is ${article(bl?.detected_kind)}.`
    case 'missing_attachment': return si ? 'No draft was attached.' : 'Nothing was attached.'
    case 'missing_value': return 'A required value is blank.'
    default: return kase.summary
  }
}

function article(kind) {
  const word = String(kind || 'another document').toLowerCase().replace(/_/g, ' ')
  return (/^[aeiou]/.test(word) ? 'an ' : 'a ') + word
}

function Labels({ comparison }) {
  const a = comparison.si?.label_seen
  const b = comparison.bl?.label_seen
  if (!a && !b) return null
  if (a && b && a === b) return <p className="corr__p">Both documents call this <b>{a}</b>.</p>
  if (a && b) return <p className="corr__p">Draft calls this <b>{b}</b>; the instruction calls it <b>{a}</b>. Read as the same field.</p>
  return <p className="corr__p">{a ? 'The instruction' : 'The draft'} calls this <b>{a || b}</b>.</p>
}

const WORKFLOW_STATUS = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  in_progress: 'In progress',
}

function WorkflowPanel({ kase, onChanged }) {
  const [assignee, setAssignee] = useState(kase.assigned_to || '')
  const [status, setStatus] = useState(kase.review_status || 'unassigned')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    setAssignee(kase.assigned_to || '')
    setStatus(kase.review_status || 'unassigned')
  }, [kase.assigned_to, kase.review_status])

  async function save(nextAssignee = assignee, nextStatus = status) {
    if (['assigned', 'in_progress'].includes(nextStatus) && !nextAssignee.trim()) {
      setMessage({ type: 'error', text: 'Add an owner before marking this case assigned or in progress.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await updateCaseWorkflow(kase.email_id, {
        assigned_to: nextAssignee.trim() || null,
        review_status: nextStatus,
      })
      await onChanged()
      setMessage({ type: 'ok', text: 'Owner and review status saved in the audit trail.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  async function assignToMe() {
    setAssignee(reviewerId)
    setStatus('assigned')
    await save(reviewerId, 'assigned')
  }

  function changeOwner(value) {
    setAssignee(value)
    if (!value.trim()) setStatus('unassigned')
    else if (status === 'unassigned') setStatus('assigned')
  }

  function changeStatus(value) {
    setStatus(value)
    if (value === 'unassigned') setAssignee('')
  }

  const unchanged = assignee.trim() === (kase.assigned_to || '')
    && status === (kase.review_status || 'unassigned')
  const currentOwner = (kase.assigned_to || '').trim()
  const ownedByMe = currentOwner === reviewerId

  return (
    <section className="workflow" aria-labelledby="workflow-title">
      <div className="workflow__head">
        <h2 id="workflow-title">Owner and review status</h2>
      </div>
      <div className="workflow__controls">
        <label>
          <span>Owner</span>
          <input value={assignee} onChange={event => changeOwner(event.target.value)} placeholder="Reviewer name or team" />
        </label>
        <label>
          <span>Review status</span>
          <select value={status} onChange={event => changeStatus(event.target.value)}>
            {Object.entries(WORKFLOW_STATUS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
            {status === 'completed' && <option value="completed">Completed</option>}
          </select>
        </label>
        <div className="workflow__actions">
          {!currentOwner && (
            <button className="btn btn--ghost btn--small" type="button" disabled={busy} onClick={assignToMe}>Assign to me</button>
          )}
          {ownedByMe && <span className="workflow__ownerstate">You are the owner</span>}
          {currentOwner && !ownedByMe && (
            <button className="btn btn--ghost btn--small" type="button" disabled={busy} onClick={assignToMe}>Take ownership</button>
          )}
          <button className="btn btn--ghost btn--small" type="button" disabled={busy || unchanged} onClick={() => save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      {message && <p className={'workflow__message workflow__message--' + message.type} role="status">{message.text}</p>}
      <p className="workflow__note">Changes are recorded with the reviewer, previous value and new value in the audit trail.</p>
    </section>
  )
}

const CHOICES = {
  MISMATCH: [
    { action: 'reject', label: 'Reject the draft', done: 'Draft rejected.' },
    { action: 'review', label: 'Hold for review', done: 'Held for review.' },
  ],
  OK: [
    { action: 'approve', label: 'Approve the draft', done: 'Draft approved.' },
    { action: 'review', label: 'Hold for review', done: 'Held for review.' },
  ],
  NEEDS_REVIEW: [
    { action: 'request', label: 'Ask for a complete instruction', done: 'Request recorded.' },
    { action: 'review', label: 'Hold for review', done: 'Held for review.' },
  ],
}

// A held case asks the sender for the specific thing that was missing.
function choicesFor(kase) {
  const base = CHOICES[kase.status] ?? CHOICES.OK
  if (kase.status !== 'NEEDS_REVIEW') return base
  const step = stepOf(kase)
  const label = ['document', 'text', 'complete'].includes(step.key) ? step.word : base[0].label
  return [{ ...base[0], label }, base[1]]
}

const CHOICE_IMPACT = {
  reject: {
    title: 'Reject this draft?',
    detail: 'This closes the case as rejected and records your decision in the audit trail. It does not edit the draft or email the sender.',
    confirm: 'Confirm rejection',
  },
  approve: {
    title: 'Approve this draft?',
    detail: 'This closes the case as approved and records your decision in the audit trail. It does not send the document onward automatically.',
    confirm: 'Confirm approval',
  },
  review: {
    title: 'Hold this case for review?',
    detail: 'This adds the case to the review queue and records the handoff. It does not send an email or change either document.',
    confirm: 'Confirm hold',
  },
  request: {
    title: 'Record this request?',
    detail: 'This adds a follow-up item to the review queue. It records the request but does not email the sender automatically.',
    confirm: 'Confirm request',
  },
}

const DECISION_RESULT = {
  reject: 'The case is closed as rejected. No email was sent.',
  approve: 'The case is closed as approved. Nothing was sent automatically.',
  review: 'The case is now in the review queue.',
  request: 'A follow-up item is now in the review queue.',
}

function Actions({ kase, onChanged }) {
  const [decision, setDecision] = useState(null)
  const [pendingChoice, setPendingChoice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const choices = choicesFor(kase)

  useEffect(() => {
    let live = true
    getCaseDecision(kase.email_id)
      .then(value => { if (live) setDecision(value) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [kase.email_id])

  async function decide(choice) {
    setBusy(true)
    setError(null)
    try {
      setDecision(await recordCaseDecision(kase.email_id, choice))
      await onChanged?.()
      setPendingChoice(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    setBusy(true)
    setError(null)
    try {
      await clearCaseDecision(kase.email_id)
      setDecision(null)
      await onChanged?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (decision) {
    return (
      <div className="fbar">
        <span className="fbar__done">
          <b>{decision.done}</b>
          <em>{DECISION_RESULT[decision.action]}</em>
        </span>
        <span className="grow"></span>
        <button className="btn btn--ghost" type="button" disabled={busy} onClick={undo}>Undo</button>
      </div>
    )
  }

  if (pendingChoice) {
    const impact = CHOICE_IMPACT[pendingChoice.action]
    return (
      <div className="fbar fbar--confirm" role="group" aria-label="Confirm case action">
        <span className="fbar__impact">
          <b>{impact.title}</b>
          <span>{impact.detail}</span>
        </span>
        <span className="grow"></span>
        <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => setPendingChoice(null)}>
          Cancel
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => decide(pendingChoice)}>
          {busy ? 'Saving…' : impact.confirm}
        </button>
      </div>
    )
  }

  return (
    <div className="fbar">
      {error && <span className="fbar__error">{error}</span>}
      <span className="fbar__prompt">Choose what should happen next. The decision will appear in the audit trail.</span>
      <span className="grow"></span>
      <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => setPendingChoice(choices[1])}>
        {choices[1].label}
      </button>
      <button className="btn" type="button" disabled={busy} onClick={() => setPendingChoice(choices[0])}>
        {choices[0].label}
      </button>
    </div>
  )
}

// "N/A" and a row of underscores are written into these documents where a value
// is absent, so they are gaps rather than values, same as an empty string.
const NOT_A_VALUE = /^(n\/?a|-+|_+|none|nil)$/i

function whyNotChecked(c) {
  const gap = v => !v || NOT_A_VALUE.test(String(v).trim())
  const siGap = gap(c.si?.value)
  const blGap = gap(c.bl?.value)
  if (siGap && blGap) return 'Neither document gives this value.'
  if (siGap) return 'The instruction does not give this value, so there was nothing to compare the draft against.'
  if (blGap) return 'The draft does not give this value in a form that could be read.'
  return 'This value was read with low confidence, so it was not compared.'
}

