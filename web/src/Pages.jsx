import { useEffect, useLayoutEffect, useRef } from 'react'
import { FIELD_ORDER, FIELD_PLAIN, confidenceOf, verdictKind } from './status.js'
import { buildStages } from './AuditTrail.jsx'

const NOT_A_VALUE = /^(n\/?a|-+|_+|none|nil)$/i

export default function Pages({ kase, docs, selected, onSelect }) {
  const ref = useRef(null)
  const svgRef = useRef(null)
  const si = kase.documents.find(d => d.role === 'SI')
  const bl = kase.documents.find(d => d.role === 'BL')
  const siText = docs?.SI?.text || null
  const blText = docs?.BL?.text || null
  const hits = buildHits(kase, siText, blText)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const draw = () => drawWires(el, svgRef.current, hits, selected)
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    window.addEventListener('resize', draw)
    document.fonts?.ready.then(draw)
    return () => { ro.disconnect(); window.removeEventListener('resize', draw) }
  }, [kase, docs, selected])

  // The thread draws itself once per selection. Later redraws (resize, fonts)
  // rebuild the SVG, so they read the remembered selection and keep it drawn.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.dataset.drawnFor = ''
    if (!svg.querySelector('path.on')) return
    const id = requestAnimationFrame(() => requestAnimationFrame(() => {
      svg.querySelector('path.on')?.classList.add('drawn')
      svg.dataset.drawnFor = selected
    }))
    return () => cancelAnimationFrame(id)
  }, [selected])

  const pick = field => onSelect(selected === field ? null : field)

  return (
    <div className="pages" ref={ref}>
      <svg className="pages__wires" ref={svgRef} aria-hidden="true"></svg>
      {siText
        ? <Sheet role="SI" document={si} text={siText} hits={hits} selected={selected} onPick={pick} />
        : <Record role="SI" document={si} kase={kase} />}
      <div className="pages__gutter" aria-hidden="true"></div>
      {blText
        ? <Sheet role="BL" document={bl} text={blText} hits={hits} selected={selected} onPick={pick} showConf />
        : <Record role="BL" document={bl} kase={kase} />}
    </div>
  )
}

function Sheet({ role, document, text, hits, selected, onPick, showConf }) {
  const lines = text.split('\n')
  const byLine = {}
  for (const h of hits) if (h[role]) byLine[h[role].line] = h
  // A file named as the draft can turn out to be something else. The sheet
  // then says what the file is, not what the email called it.
  const kind = document?.detected_kind
  const wrongKind = kind && kind !== 'UNKNOWN' && kind !== role
  const title = wrongKind ? kindWord(kind).toUpperCase() : role === 'SI' ? 'SHIPPING INSTRUCTION' : 'BILL OF LADING'
  const stamp = role === 'SI' ? 'SOURCE' : 'DRAFT'

  return (
    <section className="doc" aria-label={wrongKind ? `${kindWord(kind)}, attached as the ${role === 'SI' ? 'instruction' : 'draft'}` : role === 'SI' ? 'Shipping instruction' : 'Draft bill of lading'}>
      <header className="doc__head">
        <div>
          <h2 className="doc__title">{title}</h2>
          <span className="doc__file">{fileOf(document?.attachment_path)}</span>
        </div>
        {wrongKind
          ? <span className="doc__stamp doc__stamp--review"><span className="mk mk--review" aria-hidden="true"></span>WRONG DOCUMENT</span>
          : <span className="doc__stamp">{stamp}</span>}
      </header>
      <ol className="doc__lines">
        {lines.map((line, i) => {
          const h = byLine[i]
          if (!h) return <li className="ln" key={i}><span></span><span className="ln__text">{line || ' '}</span><span></span></li>
          const side = h[role]
          const wrong = h.kind === 'wrong' && role === 'BL'
          const on = selected === h.field
          const conf = showConf ? confidenceOf(h.comparison) : null
          const before = line.slice(0, side.at)
          const after = line.slice(side.at + side.value.length)
          return [
            <li className={'ln ln--hit' + (wrong ? ' ln--wrong' : '')} key={i} data-field={role === 'BL' ? h.field : undefined}>
              <span className="ln__tag">{h.name}</span>
              <span className="ln__text">
                {before}
                <button
                  type="button"
                  className={'hit' + (wrong ? ' hit--wrong' : '')}
                  data-on={on}
                  aria-pressed={on}
                  aria-label={`${h.name} on the ${role === 'SI' ? 'instruction' : 'draft'}: ${side.value}. Show on both pages`}
                  onClick={() => onPick(h.field)}
                >
                  {wrong ? <s>{side.value}</s> : side.value}
                </button>
                {after}
              </span>
              <span className="ln__conf">{conf ? conf.word : ''}</span>
            </li>,
            wrong && h.SI && (
              <li className="ln ln--fix" key={i + 'fix'}>
                <span className="ln__tag">should read</span>
                <span className="ln__text">{h.SI.value}</span>
                <span></span>
              </li>
            ),
          ]
        })}
      </ol>
    </section>
  )
}

// The slot a document would occupy, when there is no text to draw. It carries
// the facts of the refusal so the page is never blank.
function Record({ role, document, kase }) {
  const stages = buildStages(kase)
  const stopped = stages.find(s => s.state === 'attention' || s.state === 'wrong')
  const title = role === 'SI' ? 'SHIPPING INSTRUCTION' : 'BILL OF LADING'
  const attached = Boolean(document)
  const say = !attached
    ? `No ${role === 'SI' ? 'shipping instruction' : 'draft'} was attached.`
    : document.readable === false
      ? 'This file has no text we could read.'
      : document.detected_kind && document.detected_kind !== role
        ? `This file is a ${kindWord(document.detected_kind)}, not a ${role === 'SI' ? 'shipping instruction' : 'bill of lading'}.`
        : 'No text was available for this document.'
  return (
    <section className="doc doc--record" aria-label={`${title.toLowerCase()} not available`}>
      <header className="doc__head">
        <div>
          <h2 className="doc__title">{title}</h2>
          <span className="doc__file">{attached ? fileOf(document.attachment_path) : 'no attachment'}</span>
        </div>
        <span className="doc__stamp doc__stamp--review"><span className="mk mk--review" aria-hidden="true"></span>{attached ? 'NOT READ' : 'NOT ATTACHED'}</span>
      </header>
      <div className="record">
        <p className="record__say">{say}</p>
        <dl className="record__facts">
          {attached && <><dt>Format</dt><dd className="mono">{String(document.fmt || 'unknown').toUpperCase()}</dd></>}
          {attached && <><dt>Detected kind</dt><dd className="mono">{document.detected_kind || 'unknown'}</dd></>}
          {attached && <><dt>Text layer</dt><dd>{document.readable === false ? (document.parse_error || 'none') : 'present'}</dd></>}
          {attached && <><dt>Values read</dt><dd>{countValues(document)} of 7</dd></>}
          {stopped && <><dt>Stopped at</dt><dd>{stopped.name.toLowerCase()}, stage {stopped.number} of {stages.length}</dd></>}
        </dl>
        <ol className="record__stages" aria-label="Pipeline stages">
          {stages.map(s => (
            <li key={s.name} className={'record__stage record__stage--' + s.state} title={`${s.name}: ${s.state}`}>
              <span>{s.name.split(' ')[0].toLowerCase()}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function buildHits(kase, siText, blText) {
  const si = kase.documents.find(d => d.role === 'SI')
  const bl = kase.documents.find(d => d.role === 'BL')
  const out = []
  // A refusal has no comparisons, but whatever the instruction gave us was
  // still read. Name those lines and let each thread stop at the gutter.
  if (kase.comparisons.length === 0) {
    for (const field of FIELD_ORDER) {
      const SI = locate(siText, si?.fields?.[field])
      const BL = locate(blText, bl?.fields?.[field])
      if (SI || BL) out.push({ field, name: FIELD_PLAIN[field] || field, kind: 'review', comparison: null, SI, BL })
    }
    return out
  }
  for (const c of kase.comparisons) {
    const h = {
      field: c.field,
      name: FIELD_PLAIN[c.field] || c.field,
      kind: verdictKind(c),
      comparison: c,
      SI: locate(siText, si?.fields?.[c.field] || c.si),
      BL: locate(blText, bl?.fields?.[c.field] || c.bl),
    }
    out.push(h)
  }
  return out
}

function locate(text, field) {
  if (!text || !field) return null
  const value = field.value
  if (!value || NOT_A_VALUE.test(String(value).trim())) return null
  const loc = field.locator || {}
  const starts = lineStarts(text)
  let start = loc.char_start, end = loc.char_end
  const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length
    && text.slice(start, end) === String(value)
  if (!valid) {
    const probe = String(value).split('\n')[0]
    const found = text.indexOf(probe)
    if (found < 0) return null
    start = found; end = found + probe.length
  }
  let line = 0
  while (line + 1 < starts.length && starts[line + 1] <= start) line += 1
  const lineEnd = (starts[line + 1] ?? text.length + 1) - 1
  const at = start - starts[line]
  return { line, at, value: text.slice(start, Math.min(end, lineEnd)) }
}

function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

function drawWires(el, svg, hits, selected) {
  if (!svg) return
  const box = el.getBoundingClientRect()
  if (box.width === 0) return
  const children = [...el.children].filter(c => c.tagName !== 'svg')
  const left = children[0]?.getBoundingClientRect()
  const right = children[2]?.getBoundingClientRect()
  if (!left || !right) { svg.innerHTML = ''; return }
  svg.setAttribute('width', box.width)
  svg.setAttribute('height', box.height)
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`)
  const x1 = left.right - box.left
  const x2 = right.left - box.left
  const mx = (x1 + x2) / 2
  let out = ''
  for (const h of hits) {
    const a = el.querySelector(`.doc:first-of-type .ln--hit button[aria-label^="${cssEscape(h.name)} on the instruction"]`)
    const b = el.querySelector(`.doc:last-of-type .ln--hit button[aria-label^="${cssEscape(h.name)} on the draft"]`)
    if (!a && !b) continue
    const ya = a ? mid(a, box) : null
    const yb = b ? mid(b, box) : null
    const on = selected === h.field
    const cls = on ? 'on' : ''
    if (ya != null && yb != null) {
      out += `<path class="${cls}" pathLength="1" d="M${x1},${ya} C${mx},${ya} ${mx},${yb} ${x2},${yb}"/>`
      out += shape(x1, ya, h.kind, on) + shape(x2, yb, h.kind, on)
    } else if (ya != null) {
      out += `<path class="${cls}" pathLength="1" d="M${x1},${ya} L${mx + 6},${ya}"/>`
      out += shape(x1, ya, h.kind, on) + shape(mx + 6, ya, 'review', on)
    } else {
      out += `<path class="${cls}" pathLength="1" d="M${x2},${yb} L${mx - 6},${yb}"/>`
      out += shape(x2, yb, h.kind, on) + shape(mx - 6, yb, 'review', on)
    }
  }
  svg.innerHTML = out
  if (selected && svg.dataset.drawnFor === selected) svg.querySelector('path.on')?.classList.add('drawn')
}

function mid(node, box) {
  const r = node.getBoundingClientRect()
  return r.top - box.top + r.height / 2
}

function shape(x, y, kind, on) {
  const cls = `end end--${kind}${on ? ' on' : ''}`
  if (kind === 'wrong') return `<circle class="${cls}" cx="${x}" cy="${y}" r="4.2"/>`
  if (kind === 'review') return `<rect class="${cls}" x="${x - 4}" y="${y - 4}" width="8" height="8" rx="2.2"/>`
  return `<rect class="${cls}" x="${x - 3.6}" y="${y - 3.6}" width="7.2" height="7.2"/>`
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&')
}

function countValues(document) {
  const fields = document?.fields || {}
  return Object.values(fields).filter(f => f && f.value && !NOT_A_VALUE.test(String(f.value).trim())).length
}

function kindWord(kind) {
  return String(kind).toLowerCase().replace(/_/g, ' ')
}

function fileOf(path) {
  return String(path || '').split('/').pop()
}
