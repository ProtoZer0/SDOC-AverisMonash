import { useEffect, useState } from 'react'
import Bar from './Bar.jsx'
import Sheet from './Sheet.jsx'
import Evidence from './Evidence.jsx'
import AuditTrail from './AuditTrail.jsx'
import CaseReport from './CaseReport.jsx'
import {
  clearCaseDecision, getAuditEvents, getCase, getCaseDecision, recordCaseDecision,
  reviewerId, updateCaseWorkflow,
} from './api.js'
import { FIELD_PLAIN, KIND_WORD, REASON_TITLE, confidencePercent, kindOf, priorityOf } from './status.js'

const DASH = '—'

export default function CaseView({ id }) {
  const [kase, setCase] = useState(null)
  const [error, setError] = useState(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [selectedField, setSelectedField] = useState(null)
  const [events, setEvents] = useState(null)

  async function refreshCase() {
    const [nextCase, nextEvents] = await Promise.all([
      getCase(id),
      getAuditEvents(id).catch(() => ({ items: [] })),
    ])
    setCase(nextCase)
    setEvents(nextEvents.items)
  }

  useEffect(() => {
    setCase(null)
    setError(null)
    setAuditOpen(false)
    setSelectedField(null)
    setEvents(null)
    refreshCase().catch(e => setError(e.message))
  }, [id])

  if (error) return <Frame meta={id}><div className="state">Could not open {id}. {error}</div></Frame>
  if (!kase) return <Frame meta={id}><div className="state">Opening {id}.</div></Frame>

  let content
  if (kase.category !== 'BL_COMPARISON') content = <NotACheck kase={kase} />
  else if (drawable(kase)) {
    content = <Compared kase={kase} selected={selectedField} onSelect={setSelectedField} onChanged={refreshCase} />
  }
  else if (kase.status === 'NEEDS_REVIEW') content = <Refused kase={kase} onChanged={refreshCase} />
  else content = <NothingToCompare kase={kase} />

  const viewEvidence = drawable(kase)
    ? field => {
        setSelectedField(field)
        setAuditOpen(false)
      }
    : null

  return (
    <Frame
      meta={id}
      kase={kase}
      auditOpen={auditOpen}
      onAudit={() => setAuditOpen(!auditOpen)}
      onCloseAudit={() => setAuditOpen(false)}
      onViewEvidence={viewEvidence}
      events={events}
    >
      {content}
      <WorkflowPanel kase={kase} onChanged={refreshCase} />
    </Frame>
  )
}

// A refusal with a readable draft still gets drawn, because the confidence mark
// on each field says which ones we would not stand behind. Only when there is no
// draft to draw, or nothing was compared, does the case fall back to cards.
function drawable(kase) {
  const bl = kase.documents.find(d => d.role === 'BL')
  const hasValues = bl && bl.readable && bl.fields &&
    Object.values(bl.fields).some(f => f && f.value)
  return Boolean(hasValues) && kase.comparisons.length > 0
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

// A comparison request that came out OK with nothing to draw is not a refusal.
// Saying "needs a person" here would contradict the worklist, which shows the
// same case as all clear.
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
      <div className="quiet">Nothing was flagged, because there was nothing to check.</div>
    </div>
  )
}

function Refused({ kase, onChanged }) {
  const si = kase.documents.find(d => d.role === 'SI')
  const bl = kase.documents.find(d => d.role === 'BL')
  return (
    <>
    <div className="rmain">
      <div className="cards">
        <div className="card">
          <span className="eyebrow">Why this was flagged</span>
          <span className="card__title">{REASON_TITLE[kase.wire_review_reason] ?? 'Needs a person'}</span>
          <p className="card__body">{kase.summary}</p>
          <div className="card__evidence">
            <div><em>Instruction</em><span>{si ? si.detected_kind : 'not attached'}</span></div>
            <div><em>Draft</em><span>{bl ? bl.detected_kind : 'not attached'}</span></div>
          </div>
        </div>
      </div>
      <span className="grow"></span>
      <div className="quiet">We would rather ask than guess. Nothing here was compared.</div>
    </div>
    <Actions kase={kase} onChanged={onChanged} />
    </>
  )
}

function Compared({ kase, selected, onSelect, onChanged }) {

  const wrong = kase.comparisons.filter(c => c.verdict === 'MISMATCH')
  const blocked = kase.comparisons.filter(
    c => c.verdict !== 'MISMATCH' && (
      ['REVIEW', 'ABSENT'].includes(c.verdict) || c.confidence?.hard_fail
    ))
  const matched = kase.comparisons.filter(c => c.verdict === 'MATCH').length
  const noted = wrong.length + blocked.length
  const open = kase.comparisons.find(c => c.field === selected)
  const close = () => onSelect(null)
  const siDocument = kase.documents.find(document => document.role === 'SI')
  const blDocument = kase.documents.find(document => document.role === 'BL')
  const sourceFields = open ? {
    si: siDocument?.fields?.[open.field],
    bl: blDocument?.fields?.[open.field],
  } : null

  return (
    <>
    <div className="stage">
      <div className="sheetwrap">
        <Sheet kase={kase} selected={selected} onSelect={onSelect} />
        <p className="sheet__hint">Click any checked field to see the line it came from.</p>
      </div>
      <div className="margin">
        {noted > 0 && (
          <div className="whyhead">
            <span className="eyebrow">What needs review</span>
            <h2>{noted} field{noted === 1 ? ' needs' : 's need'} your review</h2>
            <p>Each item compares the instruction with the draft and links to the original evidence.</p>
          </div>
        )}
        {wrong.map(c => (
          <div className="issuegroup" key={c.field}>
            <MismatchNote c={c} selected={c.field === selected} onSelect={onSelect} />
          </div>
        ))}

        {blocked.map(c => (
          <div className="issuegroup" key={c.field}>
            <BlockedNote c={c} selected={c.field === selected} onSelect={onSelect} />
          </div>
        ))}

        {noted === 0
          ? <div className="quiet">All {matched} details match the instruction.</div>
          : <div className="quiet">The other {matched} details match the instruction.</div>}
      </div>
    </div>
    {open && (
      <Evidence
        emailId={kase.email_id}
        comparison={open}
        sourceFields={sourceFields}
        onClose={close}
      />
    )}
    <Actions kase={kase} onChanged={onChanged} />
    </>
  )
}

function MismatchNote({ c, selected, onSelect }) {
  return (
    <article className="note note--reason">
      <span className="note__field">{FIELD_PLAIN[c.field]} values differ</span>
      <dl className="reasonfacts">
        <div><dt>Instruction</dt><dd>{c.si.value ?? DASH}</dd></div>
        <div><dt>Draft</dt><dd className="reasonfacts__wrong">{c.bl.value ?? DASH}</dd></div>
        <div><dt>Similarity</dt><dd>{similarity(c)}</dd></div>
        <div><dt>Machine confidence</dt><dd>{confidencePercent(c) || 'Not recorded'}</dd></div>
        <div><dt>Status</dt><dd>Confirmed difference</dd></div>
      </dl>
      {c.si.label_seen && c.bl.label_seen && c.si.label_seen !== c.bl.label_seen && (
        <div className="note__synonym">
          Instruction calls this <b>{c.si.label_seen}</b>. Draft calls it <b>{c.bl.label_seen}</b>.
        </div>
      )}
      <button className="evidencelink" type="button" onClick={() => onSelect(selected ? null : c.field)}>
        {selected ? 'Hide source evidence' : 'View highlighted source evidence'}
      </button>
    </article>
  )
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
  const priority = priorityOf(kase)

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
        <div>
          <span className="eyebrow">Review ownership</span>
          <h2 id="workflow-title">Review ownership and status</h2>
        </div>
        <span className={'priority priority--' + priority.key} title={priority.reason}>{priority.label}</span>
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
          <button className="btn btn--small" type="button" disabled={busy || unchanged} onClick={() => save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      {message && <p className={'workflow__message workflow__message--' + message.type} role="status">{message.text}</p>}
      <p className="workflow__note">{priority.reason} Changes are recorded with the reviewer, previous value and new value in the audit trail.</p>
    </section>
  )
}

function BlockedNote({ c, selected, onSelect }) {
  return (
    <article className="note note--reason note--review">
      <span className="note__field">{FIELD_PLAIN[c.field]} requires confirmation</span>
      <p className="note__body">{whyNotChecked(c)}</p>
      <dl className="reasonfacts">
        <div><dt>Instruction</dt><dd>{c.si.value || DASH}</dd></div>
        <div><dt>Draft</dt><dd>{c.bl.value || DASH}</dd></div>
        <div><dt>Similarity</dt><dd>{similarity(c)}</dd></div>
        <div><dt>Machine confidence</dt><dd>{confidencePercent(c) || 'Not recorded'}</dd></div>
        <div><dt>Status</dt><dd>Requires human confirmation</dd></div>
      </dl>
      <button className="evidencelink" type="button" onClick={() => onSelect(selected ? null : c.field)}>
        {selected ? 'Hide source evidence' : 'View highlighted source evidence'}
      </button>
    </article>
  )
}

function similarity(comparison) {
  return Number.isFinite(comparison.similarity)
    ? `${Math.round(comparison.similarity)}%`
    : 'Not applicable'
}

const CHOICES = {
  MISMATCH: [
    { action: 'reject', label: 'Reject the draft', done: 'Draft rejected.' },
    { action: 'review', label: 'Send to a person', done: 'Sent to a person.' },
  ],
  OK: [
    { action: 'approve', label: 'Approve the draft', done: 'Draft approved.' },
    { action: 'review', label: 'Send to a person', done: 'Sent to a person.' },
  ],
  NEEDS_REVIEW: [
    { action: 'review', label: 'Send to a person', done: 'Sent to a person.' },
    { action: 'request', label: 'Ask for a complete instruction', done: 'Asked for a complete instruction.' },
  ],
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
    title: 'Send this for a second check?',
    detail: 'This adds the case to the Needs a person queue and records the handoff. It does not send an email or change either document.',
    confirm: 'Confirm handoff',
  },
  request: {
    title: 'Request a complete instruction?',
    detail: 'This adds a follow-up item to the Needs a person queue. It records the request but does not email the sender automatically.',
    confirm: 'Confirm request',
  },
}

const DECISION_RESULT = {
  reject: 'The case is closed as rejected. No email was sent.',
  approve: 'The case is closed as approved. Nothing was sent automatically.',
  review: 'The case is now in the Needs a person queue.',
  request: 'A follow-up item is now in the Needs a person queue.',
}

function Actions({ kase, onChanged }) {
  const [decision, setDecision] = useState(null)
  const [pendingChoice, setPendingChoice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const choices = CHOICES[kase.status] ?? CHOICES.OK

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
  const siGap = gap(c.si.value)
  const blGap = gap(c.bl.value)
  if (siGap && blGap) return 'Neither document gives this, so there was nothing to compare.'
  if (siGap) return 'The instruction does not give this, so there is nothing to compare the draft against. A blank is a gap in what we were given, not a disagreement.'
  if (blGap) return 'The draft does not give this in a form we could read, so we have not checked it.'
  return 'We could not stand behind our reading of this one, so we have not checked it.'
}
