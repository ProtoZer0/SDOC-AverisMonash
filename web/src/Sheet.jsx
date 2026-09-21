import {
  FIELD_ORDER, FIELD_WIDE, FIELD_LABEL, confidenceOf, splitPort,
} from './status.js'

export default function Sheet({ kase, selected, onSelect }) {
  const bl = kase.documents.find(d => d.role === 'BL')
  const si = kase.documents.find(d => d.role === 'SI')
  const byField = {}
  for (const c of kase.comparisons) byField[c.field] = c

  return (
    <div className="sheet">
      <div className="sheet__head">
        <div>
          <h4 className="sheet__title">BILL OF LADING</h4>
          <div className="sheet__carrier">{bl ? fileOf(bl.attachment_path) : 'no draft attached'}</div>
        </div>
        <span className="sheet__stamp">DRAFT</span>
      </div>
      <div className="sheet__grid">
        {FIELD_ORDER.map(f => (
          <Box
            key={f}
            field={f}
            bl={bl}
            si={si}
            comparison={byField[f]}
            selected={selected === f}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

function Box({ field, bl, si, comparison, selected, onSelect }) {
  const blField = bl && bl.fields ? bl.fields[field] : null
  const siField = si && si.fields ? si.fields[field] : null
  const label = (blField && blField.label_seen) || FIELD_LABEL[field]
  const conf = confidenceOf(comparison)
  const mismatch = comparison && comparison.verdict === 'MISMATCH'
  const isPort = field === 'port_of_loading' || field === 'port_of_discharge'
  const { value, sub } = isPort
    ? splitPort(blField && blField.value)
    : { value: blField && blField.value, sub: null }

  const cls = 'bx'
    + (FIELD_WIDE.includes(field) ? ' bx--full' : '')
    + (mismatch ? ' bx--flag' : '')
    + (selected ? ' bx--on' : '')

  return (
    <button
      type="button"
      className={cls}
      id={'f-' + field}
      aria-pressed={selected}
      onClick={() => onSelect(selected ? null : field)}
    >
      <span className="bx__label">
        {label}
        {conf && (
          <span className={'conf' + (conf.mod ? ' conf--' + conf.mod : '')}>
            {conf.word}
          </span>
        )}
      </span>
      {value
        ? <span className={'bx__value' + (mismatch ? ' strike' : '')}>{value}</span>
        : <span className="bx__blank">&#8212;</span>}
      {mismatch && siField && siField.value && <span className="fix">{siField.value}</span>}
      {sub && <span className="bx__sub">{sub}</span>}
    </button>
  )
}

function fileOf(path) {
  return String(path).split('/').pop()
}
