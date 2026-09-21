import { useEffect, useState } from 'react'
import { useRoute } from './route.js'
import { getHealth, offlineMode } from './api.js'
import Worklist from './Worklist.jsx'
import Analytics from './Analytics.jsx'
import Review from './Review.jsx'
import CaseView from './CaseView.jsx'

export default function App() {
  const route = useRoute()
  const [health, setHealth] = useState(null)

  useEffect(() => {
    let live = true
    const refresh = () => getHealth()
      .then(value => { if (live) setHealth(value) })
      .catch(() => {})
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div className="app">
      {offlineMode && (
        <div className="modebanner" role="status">
          <span className="modebanner__mark" aria-hidden="true">!</span>
          <span>
            <b>Sample data</b>
            {' The case service is not connected, so figures and documents are fixtures'
             + ' and anything that writes back is switched off.'}
          </span>
        </div>
      )}
      {health?.circuit_breaker === 'open' && (
        <div className="modebanner" role="status">
          <span className="modebanner__mark" aria-hidden="true">!</span>
          <span>
            <b>Deterministic-only mode</b>
            {` AI services paused after ${health.ai_failures} repeated failures. Core checks are still running.`}
          </span>
        </div>
      )}
      {route.name === 'worklist' && <Worklist health={health} />}
      {route.name === 'analytics' && <Analytics health={health} />}
      {route.name === 'review' && <Review />}
      {route.name === 'case' && <CaseView id={route.id} field={route.field} />}
    </div>
  )
}
