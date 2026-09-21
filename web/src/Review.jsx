import { useEffect, useState } from 'react'
import Bar from './Bar.jsx'
import {
  offlineMode, getReview, resolveReview, retryReview, reviewerId, updateCaseWorkflow,
} from './api.js'

const TITLE = {
  MISSING_ATTACHMENT: 'Nothing attached to check',
  UNREADABLE_DOCUMENT: 'The file will not open',
  WRONG_DOC_TYPE: 'Wrong document attached',
  FIELD_NOT_FOUND: 'A value is blank',
  GROUNDING_FAILED: 'We could not find the evidence',
  LOW_CONFIDENCE: 'Too close to call',
  BORDERLINE_MATCH: 'Too close to call',
  PROCESSING_ERROR: 'Something went wrong reading this',
  MANUAL_REVIEW_REQUESTED: 'A teammate asked for a second check',
}

const ACTIONS = {
  MISSING_ATTACHMENT: ['Ask for the draft', 'Dismiss'],
  UNREADABLE_DOCUMENT: ['Retry with OCR', 'Request a text copy'],
  WRONG_DOC_TYPE: ['Ask for the right file', 'Dismiss'],
  FIELD_NOT_FOUND: ['Fill it in', 'Dismiss'],
}

export default function Review() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(null)
  const [notice, setNotice] = useState(null)
  const [correction, setCorrection] = useState(null)
  const [sortBy, setSortBy] = useState('priority')

  useEffect(() => {
    getReview().then(d => setItems(d.items)).catch(e => setError(e.message))
  }, [])

  async function resolve(item, action, details = {}) {
    const previous = items
    setPending(item.id)
    setError(null)
    setNotice(null)
    setItems(items.filter(i => i.id !== item.id))
    try {
      await resolveReview(item.id, {
        action: details.correctValue != null ? 'correct' : 'confirm',
        field: item.fields[0] ?? null,
        correct_value: details.correctValue ?? null,
        document_role: details.documentRole ?? 'BL',
        reviewer_id: reviewerId,
      })
      setCorrection(null)
    } catch (e) {
      setItems(previous)
      setError(e.message)
    } finally {
      setPending(null)
    }
  }

  async function retry(item) {
    setPending(item.id)
    setError(null)
    setNotice(null)
    try {
      await retryReview(item.id)
      const fresh = await getReview()
      setItems(fresh.items)
      setNotice(`${item.email_id} was processed again.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setPending(null)
    }
  }

  async function updateWorkflow(item, status) {
    setPending(item.id)
    setError(null)
    setNotice(null)
    try {
      await updateCaseWorkflow(item.email_id, {
        assigned_to: item.assigned_to || reviewerId,
        review_status: status,
      })
      setItems(current => current.map(value => value.id === item.id
        ? { ...value, assigned_to: item.assigned_to || reviewerId, review_status: status }
        : value))
      setNotice(`${item.email_id} is ${status === 'in_progress' ? 'now in progress' : `assigned to ${item.assigned_to || reviewerId}`}.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setPending(null)
    }
  }

  if (error) return <Shell meta="needs a person"><div className="state">Could not reach the review service. {error}</div></Shell>
  if (!items) return <Shell meta="needs a person"><div className="state">Reading the queue.</div></Shell>

  const open = items.length
  const ordered = [...items].sort((a, b) => {
    if (sortBy === 'oldest') return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    if (sortBy === 'case_id') return a.email_id.localeCompare(b.email_id, undefined, { numeric: true })
    return reviewPriority(a).rank - reviewPriority(b).rank
      || new Date(a.created_at || 0) - new Date(b.created_at || 0)
  })

  return (
    <Shell meta={open + ' open'}>
      <div className="rmain">
        <div className="reviewhead">
          <span className="eyebrow">Human checkpoint</span>
          <h1>Cases waiting for judgement</h1>
          <p>ProtoZero stopped here instead of guessing. Open a case to inspect the source, retry a failed read, or mark the question handled.</p>
        </div>
        <div className="chips">
          <a className="chip" href="#/"><span className="mk mk--none"></span>All emails</a>
          <span className="chip chip--on"><span className="mk mk--review"></span>Needs a person<span className="chip__count">{open}</span></span>
          <label className="review-sort">
            <span>Sort queue</span>
            <select value={sortBy} onChange={event => setSortBy(event.target.value)}>
              <option value="priority">Priority first</option>
              <option value="oldest">Oldest first</option>
              <option value="case_id">Case ID</option>
            </select>
          </label>
        </div>

        {notice && <div className="reviewnotice" role="status">{notice}</div>}

        {open === 0 ? (
          <div className="state">Nothing is waiting on a person.</div>
        ) : (
          <div className="cards">
            {ordered.map(item => {
              const [primary, secondary] = ACTIONS[item.reason] ?? ['Confirm', 'Correct']
              const hasEvidence = item.si_value || item.bl_value
              const priority = reviewPriority(item)
              return (
                <div className="card" key={item.id}>
                  <div className="card__topline">
                    <span className="card__ref">{item.email_id}</span>
                    <span className={'priority priority--' + priority.key}>{priority.label}</span>
                  </div>
                  <a className="card__title" href={'#/case/' + item.email_id}>
                    {TITLE[item.reason] ?? 'Needs a person'}
                  </a>
                  <p className="card__body">{item.reason_detail}</p>
                  <div className="card__workflow">
                    <span>Owner <b>{item.assigned_to || 'Unassigned'}</b></span>
                    <span>Status <b>{workflowWord(item.review_status)}</b></span>
                  </div>
                  {hasEvidence && (
                    <div className="card__evidence">
                      <div><em>Instruction</em><span>{item.si_value ?? '—'}</span></div>
                      <div><em>Draft</em><span>{item.bl_value ?? '—'}</span></div>
                    </div>
                  )}
                  {correction?.id === item.id && (
                    <form
                      className="card__correction"
                      onSubmit={event => {
                        event.preventDefault()
                        resolve(item, 'Correct', {
                          correctValue: correction.value.trim(),
                          documentRole: correction.role,
                        })
                      }}
                    >
                      <label>
                        <span>Correct which document?</span>
                        <select
                          value={correction.role}
                          onChange={event => setCorrection({ ...correction, role: event.target.value })}
                        >
                          <option value="BL">Draft bill of lading</option>
                          <option value="SI">Shipping instruction</option>
                        </select>
                      </label>
                      <label>
                        <span>Correct value</span>
                        <input
                          value={correction.value}
                          onChange={event => setCorrection({ ...correction, value: event.target.value })}
                          placeholder="Enter the value shown in the document"
                          required
                          autoFocus
                        />
                      </label>
                      <p>The source extraction stays unchanged. This value rejoins at comparison and is recorded in the audit log.</p>
                      <div className="card__actions">
                        <button className="btn btn--small" type="submit" disabled={!correction.value.trim() || pending === item.id}>Save and compare again</button>
                        <button className="btn btn--ghost btn--small" type="button" onClick={() => setCorrection(null)}>Cancel</button>
                      </div>
                    </form>
                  )}
                  <div className="card__actions">
                    <a className="btn btn--ghost btn--small" href={'#/case/' + item.email_id}>Open case</a>
                    {!offlineMode && !item.assigned_to && (
                      <button className="btn btn--ghost btn--small" type="button" disabled={pending === item.id} onClick={() => updateWorkflow(item, 'assigned')}>
                        Assign to me
                      </button>
                    )}
                    {!offlineMode && item.assigned_to && item.review_status !== 'in_progress' && (
                      <button className="btn btn--ghost btn--small" type="button" disabled={pending === item.id} onClick={() => updateWorkflow(item, 'in_progress')}>
                        Start review
                      </button>
                    )}
                    {!offlineMode && retryable(item.reason) && (
                      <button
                        className="btn btn--ghost btn--small"
                        type="button"
                        disabled={pending === item.id}
                        onClick={() => retry(item)}
                      >
                        Retry failed stage
                      </button>
                    )}
                    {offlineMode ? (
                      <>
                        <button className="btn btn--small" type="button" onClick={() => resolve(item, primary)}>{primary}</button>
                        <button className="btn btn--ghost btn--small" type="button" onClick={() => resolve(item, secondary)}>{secondary}</button>
                      </>
                    ) : (
                      <>
                        {item.fields.length > 0 && correction?.id !== item.id && (
                          <button
                            className="btn btn--ghost btn--small"
                            type="button"
                            onClick={() => {
                              const siMissing = isBlank(item.si_value)
                              setCorrection({
                                id: item.id,
                                role: siMissing ? 'SI' : 'BL',
                                value: siMissing ? '' : (item.bl_value ?? ''),
                              })
                            }}
                          >
                            Correct a value
                          </button>
                        )}
                        {item.reason !== 'FIELD_NOT_FOUND' && (
                          <button
                            className="btn btn--small"
                            type="button"
                            disabled={pending === item.id}
                            onClick={() => resolve(item, 'Confirm')}
                          >
                            Confirm and close
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <span className="grow"></span>
        <div className="quiet">Whatever a person decides here is remembered, so the same question is not asked twice.</div>
      </div>
    </Shell>
  )
}

function isBlank(value) {
  if (value == null) return true
  const v = String(value).trim()
  return v === '' || /^(n\/?a|tba|tbd|\?+|_+)$/i.test(v)
}

function retryable(reason) {
  return ['UNREADABLE_DOCUMENT', 'GROUNDING_FAILED', 'PROCESSING_ERROR'].includes(reason)
}

function reviewPriority(item) {
  if (['MISSING_ATTACHMENT', 'UNREADABLE_DOCUMENT', 'WRONG_DOC_TYPE', 'PROCESSING_ERROR'].includes(item.reason)) {
    return { key: 'urgent', label: 'Blocked', rank: 0 }
  }
  return { key: 'high', label: 'High', rank: 1 }
}

function workflowWord(value) {
  return {
    unassigned: 'Unassigned',
    assigned: 'Assigned',
    in_progress: 'In progress',
    completed: 'Completed',
  }[value] || 'Unassigned'
}

function Shell({ meta, children }) {
  return (
    <>
      <Bar meta={meta} back="#/" title="Needs a person" />
      {children}
    </>
  )
}
