export const REVIEW_THRESHOLD = 0.55

export function kindOf(c) {
  if (c.category !== 'BL_COMPARISON') return 'none'
  if (c.status === 'MISMATCH') return 'wrong'
  if (c.status === 'NEEDS_REVIEW') return 'review'
  return 'clear'
}

export const KIND_WORD = {
  wrong: 'Differences found',
  review: 'Held for review',
  clear: 'All clear',
  none: 'Not a check',
}

export function confidenceOf(comparison) {
  const c = comparison && comparison.confidence
  if (!c) return null
  if (c.hard_fail) return { mod: 'nocheck', word: 'not checked' }
  if (c.score < REVIEW_THRESHOLD) return { mod: 'unsure', word: 'unsure' }
  return { mod: '', word: 'checked' }
}

export function confidencePercent(comparison) {
  const score = comparison?.confidence?.score
  return Number.isFinite(score) ? `${Math.round(score * 100)}%` : null
}

export const FIELD_ORDER = [
  'shipper', 'consignee', 'notify_party', 'port_of_loading',
  'port_of_discharge', 'container_count', 'gross_weight_kg',
]

export const FIELD_WIDE = ['shipper', 'consignee', 'notify_party']

export const FIELD_LABEL = {
  shipper: 'Shipper',
  consignee: 'Consignee',
  notify_party: 'Notify party',
  port_of_loading: 'Port of loading',
  port_of_discharge: 'Port of discharge',
  container_count: 'Container count',
  gross_weight_kg: 'Gross weight (KG)',
}

export const FIELD_PLAIN = {
  shipper: 'Sender',
  consignee: 'Receiver',
  notify_party: 'Notify on arrival',
  port_of_loading: 'Port of loading',
  port_of_discharge: 'Port of discharge',
  container_count: 'Containers',
  gross_weight_kg: 'Gross weight',
}

export const REASON_TITLE = {
  wrong_doc_type: 'Wrong document attached',
  missing_attachment: 'Nothing attached to check',
  unreadable: 'The file will not open',
  missing_value: 'A value is blank',
}

export const PRIORITY = {
  urgent: { label: 'Blocked', rank: 0 },
  high: { label: 'High', rank: 1 },
  normal: { label: 'Normal', rank: 2 },
  routine: { label: 'Routine', rank: 3 },
}

export function priorityOf(c) {
  if (['resolved', 'archived'].includes(c.lifecycle) || c.review_status === 'completed'
      || c.category !== 'BL_COMPARISON' || c.status === 'OK') {
    return { key: 'routine', ...PRIORITY.routine, reason: 'No human action is currently required.' }
  }
  if (['missing_attachment', 'unreadable', 'wrong_doc_type'].includes(c.wire_review_reason)) {
    return { key: 'urgent', ...PRIORITY.urgent, reason: 'Processing is blocked by a document problem.' }
  }
  if (c.status === 'NEEDS_REVIEW' || (c.defect_fields || []).length > 1) {
    return { key: 'high', ...PRIORITY.high, reason: 'Human judgement or several field differences need attention.' }
  }
  return { key: 'normal', ...PRIORITY.normal, reason: 'One confirmed difference needs action.' }
}

// Ports arrive as "NHAVA SHEVA, INDIA (INNSA)". The code is a validity check
// only and never part of the comparison, so it is shown as a subordinate line.
export function splitPort(value) {
  const m = /^(.*?)\s*\(([A-Z]{5})\)\s*$/.exec(value || '')
  return m ? { value: m[1], sub: m[2] } : { value, sub: null }
}

export function clockOf(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return String(d.getUTCHours()).padStart(2, '0') + ':' +
         String(d.getUTCMinutes()).padStart(2, '0')
}

// The three verdict kinds a compared field can carry, in the same words and
// shapes the case status uses: wrong (circle), review (rounded square), clear (square).
export function verdictKind(comparison) {
  if (!comparison) return 'review'
  if (comparison.verdict === 'MISMATCH') return 'wrong'
  if (comparison.verdict === 'MATCH' && !comparison.confidence?.hard_fail) return 'clear'
  return 'review'
}

// What leaves the desk next. Derived from status and the review reason only,
// so the worklist, the analytics page and the case page all agree.
export const STEPS = [
  { key: 'redline', label: 'Send back marked up', mk: 'wrong' },
  { key: 'document', label: 'Ask for a document', mk: 'review' },
  { key: 'text', label: 'Ask for a text copy', mk: 'review' },
  { key: 'complete', label: 'Ask to complete the instruction', mk: 'review' },
  { key: 'hand', label: 'Check by hand', mk: 'review' },
  { key: 'cleared', label: 'Cleared', mk: 'clear' },
  { key: 'other', label: 'Not a check', mk: 'none' },
]

export function stepOf(c) {
  if (c.category !== 'BL_COMPARISON') return { key: 'other', word: 'No check needed', mk: 'none' }
  if (c.status === 'MISMATCH') {
    const n = (c.defect_fields || []).length
    return { key: 'redline', word: `Send back, ${n} mark${n === 1 ? '' : 's'}`, mk: 'wrong' }
  }
  if (c.status === 'NEEDS_REVIEW') {
    const reason = c.wire_review_reason
    if (reason === 'missing_attachment') return { key: 'document', word: 'Ask for the draft', mk: 'review' }
    if (reason === 'wrong_doc_type') return { key: 'document', word: 'Ask for the right file', mk: 'review' }
    if (reason === 'unreadable') return { key: 'text', word: 'Ask for a text copy', mk: 'review' }
    if (reason === 'missing_value') return { key: 'complete', word: 'Ask to complete the instruction', mk: 'review' }
    return { key: 'hand', word: 'Check by hand', mk: 'review' }
  }
  return { key: 'cleared', word: 'Nothing to send', mk: 'clear' }
}
