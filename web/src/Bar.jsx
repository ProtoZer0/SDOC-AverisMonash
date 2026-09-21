export default function Bar({ meta, back, action, title, active }) {
  return (
    <header className="thin">
      <div className="thin__inner">
        {back && <a className="thin__back" href={back} aria-label="Back to the worklist">&#8592;</a>}
        <a className="thin__home" href="#/" aria-label="Protozero, back to the worklist">
          <span className="thin__mark">ProtoZer<span className="z">0</span></span>
        </a>
        {title && <span className="thin__divider" aria-hidden="true"></span>}
        {title && <span className="thin__section">{title}</span>}
        <span className="thin__meta">{meta}</span>
        {!back && (
          <nav className="thin__nav" aria-label="Primary navigation">
            <a href="#/analytics" aria-current={active === 'analytics' ? 'page' : undefined}>Analytics</a>
            <a href="#/" aria-current={active === 'worklist' ? 'page' : undefined}>Worklist</a>
          </nav>
        )}
        {action && <span className="thin__actions">{action}</span>}
      </div>
    </header>
  )
}
