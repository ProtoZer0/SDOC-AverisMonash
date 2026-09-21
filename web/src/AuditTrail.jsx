import { useEffect, useMemo, useState } from 'react'
import { getAuditEvents } from './api.js'
import { FIELD_ORDER, FIELD_PLAIN, REVIEW_THRESHOLD } from './status.js'

const BLANK = /^(n\/?a|tba|\?\?\?|-+|_+|none|nil)$/i

const STATE_WORD = {
  done: 'Completed',
  attention: 'Needs attention',
  wrong: 'Difference found',
  skipped: 'Not run',
}

const REASON_WORD = {
  MISSING_ATTACHMENT: 'an attachment is missing',
  UNREADABLE_DOCUMENT: 'a document could not be read',
  WRONG_DOC_TYPE: 'the attached file is the wrong document type',
  FIELD_NOT_FOUND: 'a required value is missing',
  GROUNDING_FAILED: 'the evidence could not be located in the source',
  LOW_CONFIDENCE: 'a field was read with low confidence',
  BORDERLINE_MATCH: 'two values are too close to decide automatically',
  PROCESSING_ERROR: 'a document-processing step failed',
}

export default function AuditTrail({ kase, onClose, onViewEvidence }) {
  const [copied, setCopied] = useState(false)
  const [issuesOnly, setIssuesOnly] = useState(false)
  const [events, setEvents] = useState(null)
  const stages = useMemo(() => buildStages(kase), [kase])
  const issueCount = stages.filter(stage => ['attention', 'wrong'].includes(stage.state)).length
  const visibleStages = issuesOnly
    ? stages.filter(stage => ['attention', 'wrong'].includes(stage.state))
    : stages

  useEffect(() => {
    const closeOnEscape = event => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  useEffect(() => {
    let live = true
    getAuditEvents(kase.email_id)
      .then(data => { if (live) setEvents(data.items) })
      .catch(() => { if (live) setEvents([]) })
    return () => { live = false }
  }, [kase.email_id])

  async function copySummary() {
    const lines = [
      `${kase.email_id} audit trail`,
      ...stages.map((stage, index) =>
        `${index + 1}. ${stage.name} — ${STATE_WORD[stage.state]}. ${stage.summary}`),
      `Final result — ${kase.summary}`,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  function downloadCase() {
    const blob = new Blob([
      JSON.stringify({ case: kase, events: events || [] }, null, 2),
    ], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${kase.email_id}-audit.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <button className="auditback" type="button" onClick={onClose} aria-hidden="true" tabIndex="-1"></button>
      <aside className="audit" id="case-audit" role="dialog" aria-modal="true" aria-labelledby="audit-title">
        <div className="audit__head">
          <div>
            <span className="audit__eyebrow">Case audit</span>
            <h2 className="audit__title" id="audit-title">What happened, stage by stage</h2>
          </div>
          <button className="audit__close" type="button" onClick={onClose} aria-label="Close audit trail" autoFocus>
            &#215;
          </button>
        </div>

        <p className="audit__intro">
          {events?.length
            ? 'The stages explain the current run. The activity log records system and reviewer actions.'
            : 'Generated from the saved case record. This explains the current run.'}
        </p>

        <div className="audit__overview" aria-label="Audit overview">
          <span><b>{stages.length}</b> stages</span>
          <span><b>{issueCount}</b> needing attention</span>
          {issueCount > 0 && (
            <button
              className="audit__focus"
              type="button"
              aria-pressed={issuesOnly}
              onClick={() => setIssuesOnly(!issuesOnly)}
            >
              {issuesOnly ? 'Show all stages' : 'Show issues only'}
            </button>
          )}
        </div>

        <ol className="audit__stages">
          {visibleStages.map(stage => (
            <li className={'auditstage auditstage--' + stage.state} key={stage.name}>
              <span className="auditstage__rail" aria-hidden="true">
                <span className="auditstage__node">{stage.number}</span>
              </span>
              <div className="auditstage__body">
                <div className="auditstage__top">
                  <span className="auditstage__name">{stage.name}</span>
                  <span className="auditstage__state">{STATE_WORD[stage.state]}</span>
                  {stage.duration != null && <span className="auditstage__time">{stage.duration} ms</span>}
                </div>
                <p className="auditstage__summary">{stage.summary}</p>
                {stage.facts.length > 0 && (
                  <dl className="auditstage__facts">
                    {stage.facts.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {onViewEvidence && stage.fields?.length > 0 && (
                  <div className="auditstage__links" aria-label={`${stage.name} evidence`}>
                    {stage.fields.map(field => (
                      <button type="button" key={field} onClick={() => onViewEvidence(field)}>
                        View {FIELD_PLAIN[field] || field} evidence
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="audit__result">
          <span className="audit__eyebrow">Final result</span>
          <strong>{kase.summary}</strong>
        </div>

        {events?.length > 0 && (
          <details className="auditlog" open>
            <summary>Activity log <span>{events.length}</span></summary>
            <ol>
              {events.map(event => (
                <li key={event.id}>
                  <div className="auditlog__eventhead">
                    <time dateTime={event.at}>{formatTime(event.at)}</time>
                    <strong>{event.action}</strong>
                  </div>
                  <dl className="auditlog__details">
                    <div><dt>Correlation ID</dt><dd>{event.correlation_id}</dd></div>
                    <div><dt>Timestamp</dt><dd>{formatDate(event.at)}</dd></div>
                    <div><dt>Actor</dt><dd>{event.actor === 'reviewer' ? event.reviewer_id || 'Reviewer' : 'System'}</dd></div>
                    <div><dt>Action</dt><dd>{actionWord(event.action)}</dd></div>
                    <div><dt>Previous value</dt><dd>{event.previous_value ?? '—'}</dd></div>
                    <div><dt>New value</dt><dd>{event.new_value ?? '—'}</dd></div>
                    <div><dt>Reason</dt><dd>{event.reason}</dd></div>
                  </dl>
                </li>
              ))}
            </ol>
          </details>
        )}

        <div className="audit__actions">
          <button className="btn btn--ghost btn--small" type="button" onClick={downloadCase}>
            Download case JSON
          </button>
          <button className="btn btn--ghost btn--small" type="button" onClick={copySummary}>
            {copied ? 'Copied' : 'Copy audit summary'}
          </button>
        </div>

        <details className="audittech">
          <summary>Technical details</summary>
          <dl>
            <div><dt>Trace ID</dt><dd>{kase.correlation_id || events?.[0]?.correlation_id || 'not recorded'}</dd></div>
            <div><dt>Case created</dt><dd>{formatDate(kase.created_at)}</dd></div>
            <div><dt>Last updated</dt><dd>{formatDate(kase.updated_at)}</dd></div>
            <div><dt>Pipeline</dt><dd>{kase.pipeline_version || 'not recorded'}</dd></div>
            <div><dt>Prompt</dt><dd>{kase.prompt_version || 'not used'}</dd></div>
            <div><dt>Classifier</dt><dd>{kase.models?.classify || kase.decided_by || 'not recorded'}</dd></div>
            <div><dt>Extractor</dt><dd>{kase.models?.extract || 'not run'}</dd></div>
          </dl>
        </details>
      </aside>
    </>
  )
}

export function buildStages(kase) {
  const isComparison = kase.category === 'BL_COMPARISON'
  const reasons = new Set(kase.escalation_reasons || [])
  const documents = kase.documents || []
  const comparisons = kase.comparisons || []
  const timings = kase.timings_ms || {}
  const documentIssue = ['MISSING_ATTACHMENT', 'UNREADABLE_DOCUMENT', 'WRONG_DOC_TYPE', 'PROCESSING_ERROR']
    .find(reason => reasons.has(reason))
  const fieldIssue = ['FIELD_NOT_FOUND', 'GROUNDING_FAILED', 'LOW_CONFIDENCE', 'BORDERLINE_MATCH']
    .find(reason => reasons.has(reason))

  const classify = {
    name: 'Classify email',
    state: 'done',
    duration: timings.classify,
    summary: `Sorted this email as ${categoryWord(kase.category)}.`,
    facts: [
      ['Decided by', kase.decided_by === 'llm' ? 'AI fallback' : 'deterministic rule'],
      ['Confidence', percent(kase.category_confidence)],
    ],
  }

  if (!isComparison) {
    const skip = name => ({
      name,
      state: 'skipped',
      duration: null,
      summary: 'This stage only runs for document-comparison requests.',
      facts: [],
    })
    return numberStages([
      classify,
      skip('Check documents'),
      skip('Extract fields'),
      skip('Normalize formats'),
      skip('Compare values'),
      skip('Score confidence'),
      {
        name: 'Decide',
        state: 'done',
        duration: null,
        summary: `Routed to ${categoryWord(kase.category)}; no SI and draft BL comparison was needed.`,
        facts: [['Outcome', 'Recorded and closed']],
      },
    ])
  }

  const docFacts = documents.map(document => [
    document.role === 'SI' ? 'Instruction' : 'Draft',
    documentSummary(document),
  ])
  const noDocsYet = documents.length === 0 && kase.status === 'OK'
  const gate = {
    name: 'Check documents',
    state: documentIssue ? 'attention' : noDocsYet ? 'skipped' : 'done',
    duration: null,
    summary: documentIssue
      ? `The comparison stopped here because ${REASON_WORD[documentIssue]}.`
      : noDocsYet
        ? 'No documents were attached yet, so there was nothing to check.'
        : `Found ${documents.length} document${documents.length === 1 ? '' : 's'} and checked their type and readability.`,
    facts: docFacts,
  }

  const extracted = countExtracted(documents)
  const methods = [...new Set(documents.flatMap(document =>
    Object.values(document.fields || {}).map(field => field?.extracted_by).filter(Boolean)))]
  const canExtract = !documentIssue && documents.some(document => document.readable && document.fields)
  const extract = {
    name: 'Extract fields',
    state: !canExtract ? 'skipped' : fieldIssue ? 'attention' : 'done',
    duration: canExtract ? timings.extract : null,
    summary: !canExtract
      ? 'No readable SI and draft pair reached extraction.'
      : fieldIssue
        ? `Read ${extracted.found} of ${extracted.total} available field values; ${REASON_WORD[fieldIssue]}.`
        : `Read all ${extracted.found} available field values and kept their source evidence.`,
    facts: canExtract ? [
      ['Method', methods.map(methodWord).join(', ') || 'not recorded'],
      ['Values read', `${extracted.found} of ${extracted.total}`],
      ['Evidence', `${extracted.evidence} values linked to source text`],
    ] : [],
  }

  const normalized = comparisons.length > 0
  const normalize = {
    name: 'Normalize formats',
    state: normalized ? 'done' : 'skipped',
    duration: null,
    summary: normalized
      ? `Prepared ${comparisons.length} field pairs for exact comparison using the project’s minimal normalization rules.`
      : 'No extracted field pair was available to normalize.',
    facts: normalized ? [['Rules', 'names, ports, weights and container counts only']] : [],
  }

  const verdicts = countBy(comparisons, comparison => comparison.verdict)
  const mismatchFields = comparisons
    .filter(comparison => comparison.verdict === 'MISMATCH')
    .map(comparison => FIELD_PLAIN[comparison.field] || comparison.field)
  const undecided = (verdicts.REVIEW || 0) + (verdicts.ABSENT || 0)
  const compare = {
    name: 'Compare values',
    state: !normalized ? 'skipped' : mismatchFields.length > 0 ? 'wrong' : undecided > 0 ? 'attention' : 'done',
    duration: normalized ? timings.compare : null,
    summary: !normalized
      ? 'Comparison did not run.'
      : mismatchFields.length > 0
        ? `${joinWords(mismatchFields)} ${mismatchFields.length === 1 ? 'does' : 'do'} not match the instruction.`
        : undecided > 0
          ? `No confirmed difference was found, but ${undecided} field${undecided === 1 ? '' : 's'} could not be decided.`
          : `No difference was found across ${comparisons.length} checked fields.`,
    facts: normalized ? [
      ['Matched', String(verdicts.MATCH || 0)],
      ['Different', String(verdicts.MISMATCH || 0)],
      ['Not decided', String(undecided)],
    ] : [],
    fields: evidenceFields(comparisons, comparison => comparison.verdict !== 'MATCH'),
  }

  const confidence = countConfidence(comparisons)
  const confidenceScores = comparisons
    .map(comparison => comparison.confidence?.score)
    .filter(Number.isFinite)
  const averageConfidence = confidenceScores.length
    ? Math.round(confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length * 100) + '%'
    : 'not recorded'
  const lowestConfidence = confidenceScores.length
    ? Math.round(Math.min(...confidenceScores) * 100) + '%'
    : 'not recorded'
  const confidenceStage = {
    name: 'Score confidence',
    state: !normalized ? 'skipped' : confidence.unsure + confidence.notChecked > 0 ? 'attention' : 'done',
    duration: null,
    summary: !normalized
      ? 'There were no compared fields to score.'
      : confidence.unsure + confidence.notChecked > 0
        ? `${confidence.unsure + confidence.notChecked} field${confidence.unsure + confidence.notChecked === 1 ? '' : 's'} could not be fully trusted.`
        : `All ${confidence.checked} compared fields passed the confidence checks.`,
    facts: normalized ? [
      ['Checked', String(confidence.checked)],
      ['Unsure', String(confidence.unsure)],
      ['Not checked', String(confidence.notChecked)],
      ['Average score', averageConfidence],
      ['Lowest score', lowestConfidence],
    ] : [],
    fields: evidenceFields(comparisons, comparison =>
      comparison.confidence?.hard_fail ||
      (Number.isFinite(comparison.confidence?.score) && comparison.confidence.score < REVIEW_THRESHOLD)),
  }

  const decideState = kase.status === 'MISMATCH' ? 'wrong'
    : kase.status === 'NEEDS_REVIEW' ? 'attention' : 'done'
  const reasonText = (kase.escalation_reasons || []).map(reason => REASON_WORD[reason] || reason).join('; ')
  const decide = {
    name: 'Decide',
    state: decideState,
    duration: null,
    summary: kase.status === 'MISMATCH'
      ? `Reported ${kase.defect_fields.length} confirmed difference${kase.defect_fields.length === 1 ? '' : 's'}.`
      : kase.status === 'NEEDS_REVIEW'
        ? 'Held the case for review instead of guessing.'
        : noDocsYet
          ? 'Recorded that there was nothing to compare yet.'
          : 'Cleared the draft because every checked field matched.',
    facts: reasonText ? [['Reason', reasonText]] : [['Status', kase.status.replace(/_/g, ' ')]],
  }

  return numberStages([classify, gate, extract, normalize, compare, confidenceStage, decide])
}

function numberStages(stages) {
  return stages.map((stage, index) => ({ ...stage, number: index + 1 }))
}

function evidenceFields(comparisons, include) {
  return comparisons
    .filter(include)
    .filter(comparison => comparison.si?.locator || comparison.bl?.locator)
    .map(comparison => comparison.field)
}

function countExtracted(documents) {
  let found = 0
  let evidence = 0
  let total = 0
  for (const document of documents) {
    if (!document.fields) continue
    for (const fieldName of FIELD_ORDER) {
      total += 1
      const field = document.fields[fieldName]
      if (hasValue(field?.value)) found += 1
      if (field?.evidence) evidence += 1
    }
  }
  return { found, evidence, total }
}

function countConfidence(comparisons) {
  const out = { checked: 0, unsure: 0, notChecked: 0 }
  for (const comparison of comparisons) {
    const confidence = comparison.confidence
    if (!confidence || confidence.hard_fail) out.notChecked += 1
    else if (confidence.score < REVIEW_THRESHOLD) out.unsure += 1
    else out.checked += 1
  }
  return out
}

function countBy(items, keyOf) {
  return items.reduce((out, item) => {
    const key = keyOf(item)
    out[key] = (out[key] || 0) + 1
    return out
  }, {})
}

function hasValue(value) {
  return value != null && String(value).trim() !== '' && !BLANK.test(String(value).trim())
}

function categoryWord(category) {
  return String(category || 'unknown').toLowerCase().replace(/_/g, ' ')
}

function documentSummary(document) {
  const kind = String(document.detected_kind || 'unknown').toLowerCase().replace(/_/g, ' ')
  return `${kind} · ${document.readable ? 'readable' : 'unreadable'} · ${document.fmt}`
}

function methodWord(method) {
  return {
    parser: 'deterministic parser',
    doc_intelligence: 'Document Intelligence',
    llm: 'AI fallback',
    human: 'human correction',
  }[method] || method
}

function percent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'not recorded'
}

function formatDate(value) {
  if (!value) return 'not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

function actionWord(action) {
  return String(action || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, letter => letter.toUpperCase())
}

function joinWords(words) {
  if (words.length < 2) return words[0] || ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}
