import { useState } from 'react'
import { FIELD_LABEL, FIELD_ORDER, REASON_TITLE } from './status.js'
import { downloadUrl, getCaseReportPdfUrl } from './api.js'

const DASH = '—'

export default function CaseReport({ kase, events }) {
  const documents = kase.documents || []
  const comparisons = kase.comparisons || []
  const corrections = (events || []).filter(event => event.action === 'HUMAN_CORRECTION')
  const issueFields = new Set([
    ...comparisons
      .filter(value => value.verdict !== 'MATCH' || value.human_reviewed)
      .map(value => value.field),
    ...corrections.map(event => event.field).filter(Boolean),
  ])
  const issueComparison = comparisons.find(value => issueFields.has(value.field))
  const completePairs = comparisons.filter(value => hasValue(value.si?.value) && hasValue(value.bl?.value)).length
  const methods = new Set(documents.flatMap(document =>
    FIELD_ORDER.map(field => document.fields?.[field]?.extracted_by).filter(Boolean)))
  const usedAi = methods.has('llm') || methods.has('doc_intelligence')
  const confidenceScores = comparisons
    .map(value => value.confidence?.score)
    .filter(Number.isFinite)
  const averageConfidence = confidenceScores.length
    ? `${Math.round(confidenceScores.reduce((sum, value) => sum + value, 0) / confidenceScores.length * 100)}%`
    : 'Not recorded'
  const reportUrl = getCaseReportPdfUrl(kase.email_id)
  const [building, setBuilding] = useState(false)
  const [reportError, setReportError] = useState(null)
  const [copied, setCopied] = useState(false)

  const amendments = comparisons
    .filter(value => value.verdict === 'MISMATCH' || value.verdict === 'REVIEW')
    .map(value => ({
      field: value.field,
      label: FIELD_LABEL[value.field] || value.field,
      draft: value.bl?.value,
      instruction: value.si?.value,
      certain: value.verdict === 'MISMATCH',
    }))

  async function copyAmendments() {
    const lines = [
      `Draft BL amendments - ${kase.email_id}`,
      kase.subject || '',
      '',
      ...amendments.flatMap(item => [
        `${item.label}${item.certain ? '' : ' (please confirm)'}`,
        `  draft reads:  ${item.draft ?? DASH}`,
        `  should read:  ${item.instruction ?? DASH}`,
      ]),
      '',
      ...corrections.map(event =>
        `Amended by ${event.reviewer_id || 'reviewer'}: ${FIELD_LABEL[event.field] || event.field}`
        + ` - was ${event.previous_value ?? DASH}, now ${event.new_value ?? DASH}`),
      `Checked against the Shipping Instruction. ${amendments.length} field`
      + `${amendments.length === 1 ? '' : 's'} to amend.`,
    ].filter(line => line !== null)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  async function downloadReport() {
    setBuilding(true)
    setReportError(null)
    try {
      await downloadUrl(reportUrl, `${kase.email_id}-case-report.pdf`)
    } catch (e) {
      setReportError(e.message)
    } finally {
      setBuilding(false)
    }
  }

  return (
    <section className="casereport" aria-labelledby="case-report-title">
      <div className="casereport__head">
        <h2 id="case-report-title">Case report</h2>
        <div className="casereport__actions">
          <button
            className="casereport__download"
            type="button"
            disabled={!reportUrl || building}
            aria-busy={building}
            onClick={downloadReport}
            title={reportUrl ? undefined : 'Connect the live API to download this report'}
          >
            {building ? 'Building the report…' : 'Download PDF'}
          </button>
          {amendments.length > 0 && (
            <button className="casereport__download" type="button" onClick={copyAmendments}>
              {copied ? 'Copied' : 'Copy amendments'}
            </button>
          )}
          {reportError && <small className="casereport__error">{reportError}</small>}
        </div>
      </div>

      <dl className="reportgrid">
        <ReportFact label="Case ID" value={kase.email_id} mono />
        <div className="reportfact">
          <dt>Documents</dt>
          <dd className="reportdocs">
            <DocumentState role="SI" documents={documents} />
            <DocumentState role="BL" documents={documents} />
          </dd>
        </div>
        <div className="reportfact">
          <dt>Issues</dt>
          <dd>{issueSummary(kase, issueFields, comparisons)}</dd>
        </div>
        <ReportFact
          label={usedAi ? 'AI extraction' : 'Field extraction'}
          value={comparisons.length ? `${completePairs}/${FIELD_ORDER.length} field pairs` : 'Not run'}
          note={usedAi ? 'AI-assisted' : methods.has('parser') ? 'Deterministic parser' : null}
        />
        <ReportFact label="Human corrections" value={String(corrections.length)} />
        <ReportFact label="Average field confidence" value={averageConfidence} note="Machine score" />
        <ReportFact label="Audit events" value={events == null ? 'Loading…' : String(events.length)} />
        <div className="reportfact reportfact--evidence">
          <dt>Evidence location</dt>
          <dd>{issueComparison ? evidenceLocation(issueComparison) : 'No flagged evidence'}</dd>
        </div>
      </dl>
    </section>
  )
}

// The tick means read and usable. Anything less says what it is instead.
function DocumentState({ role, documents }) {
  const name = role === 'SI' ? 'Shipping instruction' : 'Bill of lading'
  const document = documents.find(item => item.role === role)
  if (!document) return <span>{DASH} {name}, not attached</span>
  if (document.readable === false) return <span className="is-review">{name}, not read</span>
  if (document.detected_kind && document.detected_kind !== 'UNKNOWN' && document.detected_kind !== role) {
    return <span className="is-review">{name}, wrong document</span>
  }
  return <span className="is-present">✓ {name}</span>
}

function ReportFact({ label, value, note, mono = false }) {
  return (
    <div className="reportfact">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : ''}>{value}</dd>
      {note && <small>{note}</small>}
    </div>
  )
}

// Counts only. The fields themselves are named on the pages above; the report
// keeps its own result for export without giving them a third home.
function issueSummary(kase, issueFields, comparisons) {
  if (issueFields.size) {
    const tally = { corrected: 0, differ: 0, review: 0 }
    for (const field of issueFields) {
      const comparison = comparisons.find(value => value.field === field)
      if (comparison?.human_reviewed && comparison.verdict === 'MATCH') tally.corrected += 1
      else if (comparison?.verdict === 'MISMATCH') tally.differ += 1
      else tally.review += 1
    }
    return [
      tally.differ && `${tally.differ} field${tally.differ === 1 ? '' : 's'} differ`,
      tally.review && `${tally.review} not checked`,
      tally.corrected && `${tally.corrected} corrected by a person`,
    ].filter(Boolean).join(', ')
  }
  if (kase.wire_review_reason) return REASON_TITLE[kase.wire_review_reason] || kase.wire_review_reason
  return comparisons.length ? 'None' : 'Not compared'
}

function evidenceLocation(comparison) {
  return `SI ${locatorWord(comparison.si?.locator)} · BL ${locatorWord(comparison.bl?.locator)}`
}

function locatorWord(locator) {
  if (!locator) return 'location unavailable'
  if (locator.page != null) return `page ${locator.page}`
  if (locator.sheet) return `${locator.sheet}, row ${locator.line ?? '—'}`
  if (locator.line != null) return `line ${locator.line + 1}`
  return 'location unavailable'
}

function hasValue(value) {
  return value != null && String(value).trim() !== ''
}
