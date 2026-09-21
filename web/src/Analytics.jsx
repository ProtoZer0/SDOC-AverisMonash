import { useEffect, useState } from 'react'
import Bar from './Bar.jsx'
import Dashboard from './Dashboard.jsx'
import { getCases } from './api.js'

export default function Analytics({ health }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getCases().then(data => setItems(data.items)).catch(reason => setError(reason.message))
  }, [])

  const openWorklist = filter => {
    const params = new URLSearchParams()
    if (filter.kind !== 'none') {
      params.set('kind', filter.kind)
      params.set('value', filter.value)
    }
    params.set('view', filter.view || 'all')
    window.location.hash = `#/worklist?${params}`
  }

  return (
    <>
      <Bar title="Analytics" meta={items ? items.length + ' emails' : 'case register'} active="analytics" />
      <main className="amain">
        <header className="analyticshero">
          <div>
            <span className="eyebrow">Case register</span>
            <h1>What the desk got back, and what is left.</h1>
            <p>Every number is counted from the case register. Select any bar or box to open those cases in the worklist.</p>
          </div>
          <a className="btn btn--ghost btn--small" href="#/">Open worklist</a>
        </header>
        {error && <div className="state state--error"><b>Could not load analytics.</b><span>{error}</span></div>}
        {!items && !error && <div className="state">Counting the register.</div>}
        {items && <Dashboard health={health} items={items} onDrillDown={openWorklist} />}
      </main>
    </>
  )
}
