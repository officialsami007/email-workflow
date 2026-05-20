import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

// tailwind class mapping for each category
const CATEGORY_STYLES = {
  'Product Enquiry':   { bg: 'bg-blue-100',    text: 'text-blue-800',    dot: 'bg-blue-500'    },
  'Service Request':   { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' },
  'Quote Follow-up':   { bg: 'bg-purple-100',  text: 'text-purple-800',  dot: 'bg-purple-500'  },
  'Urgent Escalation': { bg: 'bg-red-100',     text: 'text-red-800',     dot: 'bg-red-500'     },
  'Unclear':           { bg: 'bg-slate-200',   text: 'text-slate-700',   dot: 'bg-slate-500'   },
}

// preset emails for the paste-and-try tab - covers the 5 assessment cases plus a few extras
const SAMPLE_EMAILS = [
  {
    label: 'Product enquiry',
    body: "Hi, we're looking for a Fitting – SS, Male Elbow, 1/2in. Can you advise on availability and lead time?",
  },
  {
    label: 'Service request',
    body: "Our gauge installed last year is showing inconsistent readings. Serial number FC-2291. We need a technician on site ASAP, based in Penang.",
  },
  {
    label: 'Quote follow-up',
    body: "Just following up on quote QT-4821 we received 2 weeks ago. Has pricing changed? We're ready to proceed.",
  },
  {
    label: 'Vague / junk',
    body: "Hello please call me back regarding your products thanks",
  },
  {
    label: 'Urgent escalation',
    body: "URGENT — production line down. The pressure relief valve you supplied last month has failed. Need emergency replacement or technician TODAY. Contact: Ahmad, 012-3456789",
  },
  {
    label: 'Bulk order',
    body: "Hi team, we need a quote for 50 units of stainless steel ball valves, 1 inch, and 20 units of pressure transducers (0-100 PSI range). Delivery to Shah Alam by end of next month. Thanks, Lina, Procurement Lead, +60 13 555 0199",
  },
  {
    label: 'Calibration request',
    body: "Good morning, we have 8 flow meters that are overdue for annual calibration. Models FM-200 and FM-220. Can your team come to our Johor Bahru facility next week? Reference our service contract SC-2024-117.",
  },
  {
    label: 'Spam-ish',
    body: "Dear Sir/Madam, We are a leading supplier of industrial pumps and would like to offer our products. Please find attached our catalogue. Best regards.",
  },
]


// ---- small reusable bits ----

function Card({ children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

function CategoryBadge({ category }) {
  const s = CATEGORY_STYLES[category] || CATEGORY_STYLES['Unclear']
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`}></span>
      {category}
    </span>
  )
}

// the model returns 0.9 or 0.95 most of the time, so a percent bar feels like fake precision.
// 3 buckets is closer to what we actually know. raw float still shown small for transparency.
function ConfidenceIndicator({ value }) {
  const v = value || 0
  let label, dot, text, ring
  if (v >= 0.85) {
    label = 'High confidence'
    dot = 'bg-emerald-500'; text = 'text-emerald-700'; ring = 'ring-emerald-200 bg-emerald-50'
  } else if (v >= 0.6) {
    label = 'Medium confidence'
    dot = 'bg-amber-500'; text = 'text-amber-700'; ring = 'ring-amber-200 bg-amber-50'
  } else {
    label = 'Low — review'
    dot = 'bg-red-500'; text = 'text-red-700'; ring = 'ring-red-200 bg-red-50'
  }
  return (
    <span
      title={`Raw model score: ${v.toFixed(2)}`}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ring-1 ${ring} ${text} text-xs font-medium`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span>
      {label}
      <span className="text-slate-400 font-normal tabular-nums ml-0.5">({v.toFixed(2)})</span>
    </span>
  )
}

function Stat({ label, value, accent }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent || 'text-slate-900'}`}>{value}</div>
    </Card>
  )
}


// ---- result card: shows the email on the left and what the pipeline did with it on the right ----

function ResultCard({ result }) {
  const [showDraft, setShowDraft] = useState(false)
  const c = result.classification || {}
  const cat = c.category || 'Error'
  const fields = c.fields || {}
  const filledFields = Object.entries(fields).filter(([, v]) => v != null && v !== '')

  return (
    <Card className="overflow-hidden">
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">

        {/* original email */}
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Incoming email</div>
          <div className="font-semibold text-slate-900 mb-2 text-sm">{result.subject || '(no subject)'}</div>
          <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{result.body}</div>
        </div>

        {/* what the pipeline returned */}
        <div className="p-5 bg-slate-50/50">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <CategoryBadge category={cat} />
            <ConfidenceIndicator value={c.confidence || 0} />
          </div>

          {c.reasoning && (
            <div className="text-xs text-slate-600 italic border-l-2 border-slate-300 pl-3 py-1 mb-3">
              {c.reasoning}
            </div>
          )}

          {filledFields.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Extracted</div>
              <div className="space-y-0.5">
                {filledFields.map(([k, v]) => (
                  <div key={k} className="text-sm flex gap-2">
                    <span className="text-slate-500 capitalize min-w-[110px]">{k.replace(/_/g, ' ')}:</span>
                    <span className="text-slate-800 font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">Routing</div>
            <ul className="space-y-1">
              {result.routing.actions.map((a, i) => {
                const isUrgent = a.includes('PRIORITY') || a.includes('ALERT') || a.includes('pinged')
                return (
                  <li key={i} className={`text-sm flex items-start gap-2 ${isUrgent ? 'text-red-700 font-medium' : 'text-slate-700'}`}>
                    <span className="mt-0.5">{isUrgent ? '🚨' : '→'}</span>
                    <span>{a}</span>
                  </li>
                )
              })}
            </ul>
          </div>

          {result.draft_reply && (
            <div>
              <button
                onClick={() => setShowDraft(!showDraft)}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
              >
                {showDraft ? '▾' : '▸'} Auto-drafted reply
              </button>
              {showDraft && (
                <div className="mt-2 text-sm text-slate-700 bg-blue-50 border-l-2 border-blue-400 p-3 rounded whitespace-pre-wrap">
                  {result.draft_reply}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}


// collapsed preview of the test emails - so you can see what's about to be sent before hitting run
function EmailPreviewList({ samples }) {
  const [open, setOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  if (samples.length === 0) return null

  return (
    <Card className="mb-4 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-sm">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-medium text-slate-700">
            Preview the {samples.length} emails that will be sent
          </span>
        </div>
        <span className="text-xs text-slate-400">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {samples.map((s) => {
            const isOpen = expandedId === s.id
            return (
              <div key={s.id}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : s.id)}
                  className="w-full px-5 py-2.5 flex items-center justify-between hover:bg-slate-50/70 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-slate-400 shrink-0">{s.id}</span>
                    <span className="text-sm font-medium text-slate-800 truncate">
                      {s.subject || '(no subject)'}
                    </span>
                  </div>
                  <span className="text-slate-400 text-xs ml-2 shrink-0">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-3 pt-1 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50/50 border-t border-slate-100">
                    {s.body}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}


// ---- main app ----

export default function App() {
  const [tab, setTab] = useState('batch')

  // batch run state
  const [samples, setSamples] = useState([])
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)

  // backend status
  const [healthy, setHealthy] = useState(null)
  const [apiKeyConfigured, setApiKeyConfigured] = useState(null)

  // shared error state across tabs
  const [error, setError] = useState('')

  // custom email state (for the paste-your-own tab)
  const [customSubject, setCustomSubject] = useState('')
  const [customBody, setCustomBody] = useState('')
  const [customResult, setCustomResult] = useState(null)
  const [customRunning, setCustomRunning] = useState(false)

  // ping backend on mount + grab the sample emails
  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setHealthy(true)
        setApiKeyConfigured(data.api_key_configured)
      })
      .catch(() => setHealthy(false))

    fetch(`${API_BASE}/api/samples`)
      .then((r) => r.json())
      .then(setSamples)
      .catch(() => {})
  }, [])

  async function runBatch() {
    setError('')
    setRunning(true)
    setResults([])
    try {
      const r = await fetch(`${API_BASE}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: samples }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Request failed' }))
        throw new Error(err.detail || 'Request failed')
      }
      const data = await r.json()
      setResults(data.results)
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  async function runCustom() {
    if (!customBody.trim()) {
      setError('Paste an email body first.')
      return
    }
    setError('')
    setCustomRunning(true)
    setCustomResult(null)
    try {
      const r = await fetch(`${API_BASE}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: [{ id: 'custom', subject: customSubject, body: customBody }],
        }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Request failed' }))
        throw new Error(err.detail || 'Request failed')
      }
      const data = await r.json()
      setCustomResult(data.results[0])
    } catch (e) {
      setError(e.message)
    } finally {
      setCustomRunning(false)
    }
  }

  function loadSample(body) {
    setCustomSubject('')
    setCustomBody(body)
    setCustomResult(null)
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'output.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // top-of-page summary numbers after a run
  const summary = (() => {
    if (results.length === 0) return null
    const byCat = {}
    let flagged = 0
    let drafts = 0
    for (const r of results) {
      const c = r.classification || {}
      byCat[c.category] = (byCat[c.category] || 0) + 1
      if ((c.confidence || 0) < 0.6) flagged += 1
      if (r.draft_reply) drafts += 1
    }
    return {
      total: results.length,
      urgent: byCat['Urgent Escalation'] || 0,
      flagged,
      drafts,
    }
  })()

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
              ✉
            </div>
            <div>
              <div className="font-semibold text-slate-900">AI Email Triage</div>
            </div>
          </div>

          <div className={`text-xs font-medium flex items-center gap-1.5 ${
            healthy === true ? 'text-emerald-700' : healthy === false ? 'text-red-700' : 'text-slate-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              healthy === true ? 'bg-emerald-500' : healthy === false ? 'bg-red-500' : 'bg-slate-400'
            }`}></span>
            {healthy === true ? 'Backend connected' : healthy === false ? 'Backend offline' : 'Connecting…'}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">

        {/* setup-needed banner shown only when backend is reachable but key isn't set */}
        {apiKeyConfigured === false && healthy && (
          <Card className="p-5 mb-6 border-amber-300 bg-amber-50">
            <div className="flex items-start gap-3">
              <div className="text-amber-600 text-lg leading-none mt-0.5">⚠</div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-amber-900 mb-1">Backend is missing the Groq API key</div>
                <div className="text-sm text-amber-800">
                  Add your key to <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">backend/.env</code> and restart the server:
                </div>
                <pre className="mt-2 text-xs bg-amber-100 text-amber-900 p-2 rounded font-mono overflow-x-auto">
{`cp backend/.env.example backend/.env
# edit .env, set GROQ_API_KEY=your_key_here
# then restart: uvicorn server:app --reload --port 8000`}
                </pre>
                <div className="text-xs text-amber-700 mt-2">
                  Get a free key at <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="underline">console.groq.com</a>.
                </div>
              </div>
            </div>
          </Card>
        )}

        {apiKeyConfigured === true && (
          <Card className="p-4 mb-6 border-emerald-200 bg-emerald-50">
            <div className="flex items-center gap-2 text-sm text-emerald-800">
              <span className="text-emerald-600">✓</span>
              <span className="font-medium">Backend ready.</span>
            </div>
          </Card>
        )}

        {/* tab bar */}
        <div className="flex gap-1 border-b border-slate-200 mb-6">
          {[
            { id: 'batch', label: 'Run on test emails' },
            { id: 'custom', label: 'Paste your own email' },
            { id: 'about', label: 'How it works' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-800">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        {/* batch run tab */}
        {tab === 'batch' && (
          <div>
            <Card className="p-5 mb-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="font-semibold text-slate-900">5 assessment test emails</div>
                  <div className="text-sm text-slate-500">Run all five through the classification pipeline.</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runBatch}
                    disabled={running || samples.length === 0}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium text-sm rounded-md transition-colors flex items-center gap-2"
                  >
                    {running ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                        Processing…
                      </>
                    ) : (
                      <>▶ Run workflow</>
                    )}
                  </button>
                  {results.length > 0 && (
                    <button
                      onClick={downloadJson}
                      className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium text-sm rounded-md transition-colors"
                    >
                      ⬇ output.json
                    </button>
                  )}
                </div>
              </div>
            </Card>

            <EmailPreviewList samples={samples} />

            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 mt-6">
                <Stat label="Processed" value={summary.total} />
                <Stat label="Urgent" value={summary.urgent} accent={summary.urgent > 0 ? 'text-red-600' : ''} />
                <Stat label="Flagged" value={summary.flagged} accent={summary.flagged > 0 ? 'text-amber-600' : ''} />
                <Stat label="Drafts" value={summary.drafts} accent="text-blue-600" />
              </div>
            )}

            <div className="space-y-4">
              {results.length === 0 && !running && (
                <Card className="p-12 text-center text-slate-500 text-sm">
                  {samples.length === 0
                    ? 'Backend not reachable. Start the FastAPI server first.'
                    : 'Click "Run workflow" to process the 5 test emails.'}
                </Card>
              )}
              {results.map((r) => (
                <ResultCard key={r.id} result={r} />
              ))}
            </div>
          </div>
        )}

        {/* custom email tab */}
        {tab === 'custom' && (
          <div className="space-y-6">
            <Card className="p-5">
              <div className="font-semibold text-slate-900 mb-1">Paste any email</div>
              <div className="text-sm text-slate-500 mb-4">
                Type or paste an email below, then classify it. Same pipeline that runs the test batch.
              </div>

              <input
                type="text"
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                placeholder="Subject (optional)"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <textarea
                value={customBody}
                onChange={(e) => setCustomBody(e.target.value)}
                placeholder="Paste the email body here..."
                rows={8}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />

              <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
                <div className="text-xs text-slate-500">{customBody.length} characters</div>
                <button
                  onClick={runCustom}
                  disabled={customRunning || !customBody.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium text-sm rounded-md transition-colors"
                >
                  {customRunning ? 'Classifying…' : '▶ Classify this email'}
                </button>
              </div>
            </Card>

            <Card className="p-5">
              <div className="font-semibold text-slate-900 mb-1">Sample emails to try</div>
              <div className="text-sm text-slate-500 mb-4">
                Click any sample to load it into the textarea, then classify.
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {SAMPLE_EMAILS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => loadSample(s.body)}
                    className="text-left p-3 rounded-md border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-colors"
                  >
                    <div className="text-xs font-semibold text-slate-700 mb-1">{s.label}</div>
                    <div className="text-xs text-slate-500 line-clamp-2">{s.body}</div>
                  </button>
                ))}
              </div>
            </Card>

            {customResult && <ResultCard result={customResult} />}
          </div>
        )}

        {/* about / how it works tab */}
        {tab === 'about' && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">How it works</h2>
            <ol className="space-y-3 text-sm text-slate-700 list-decimal list-inside">
              <li><strong>Email comes in.</strong> Just the subject and body — plain text, nothing fancy.</li>
              <li><strong>One model call does the heavy lifting.</strong> The email goes to Llama 3.3 70B (via Groq) with a prompt that asks for a category, any useful fields pulled from the text (name, contact, product or serial number, location), and a one-line reason for the decision. It all comes back as a single JSON blob.</li>
              <li><strong>The response gets validated.</strong> If the model returns something malformed, it gets one retry. If that also fails, the email is marked <code className="bg-slate-100 px-1 rounded">Unclear</code> with confidence 0 and the batch keeps going — nothing blows up.</li>
              <li><strong>Routing happens based on category.</strong> Each category maps to a destination: Sales, Service, an ops alert, or a human review queue. Urgent escalations get an extra alert on top. Anything the model isn't confident about gets flagged for a human even if it was given a category.</li>
              <li><strong>Sales emails get a draft reply.</strong> For Product Enquiries and Quote Follow-ups, a second model call writes a short acknowledgement that references whatever product or quote number was mentioned. Service and urgent emails don't get auto-replies — those need a real person.</li>
            </ol>

            <h3 className="text-base font-semibold text-slate-900 mt-6 mb-2">About the confidence score</h3>
            <p className="text-sm text-slate-700">
              The model gives itself a confidence score from 0 to 1, but in practice it almost always picks something like 0.9 or 0.95 — so showing a precise percentage would be misleading. Instead the UI groups scores into three buckets: <strong>High</strong> (≥ 0.85), <strong>Medium</strong> (0.6 – 0.85), and <strong>Low — review</strong> (below 0.6). The raw number is still there in small text if you want to see it. Anything under 0.6 gets routed for human review regardless of what category was assigned.
            </p>

            <h3 className="text-base font-semibold text-slate-900 mt-6 mb-2">Categories and routing</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Routes to</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr><td className="py-2 pr-3"><CategoryBadge category="Product Enquiry" /></td><td className="py-2 pr-3 text-slate-700">Sales team</td><td className="py-2 text-slate-700">Forward + auto-draft</td></tr>
                <tr><td className="py-2 pr-3"><CategoryBadge category="Service Request" /></td><td className="py-2 pr-3 text-slate-700">Service team</td><td className="py-2 text-slate-700">Forward</td></tr>
                <tr><td className="py-2 pr-3"><CategoryBadge category="Quote Follow-up" /></td><td className="py-2 pr-3 text-slate-700">Sales team</td><td className="py-2 text-slate-700">Forward + auto-draft</td></tr>
                <tr><td className="py-2 pr-3"><CategoryBadge category="Urgent Escalation" /></td><td className="py-2 pr-3 text-slate-700">Ops alerts</td><td className="py-2 text-slate-700">High-priority alert + Slack ping</td></tr>
                <tr><td className="py-2 pr-3"><CategoryBadge category="Unclear" /></td><td className="py-2 pr-3 text-slate-700">Human review</td><td className="py-2 text-slate-700">Queued for manual triage</td></tr>
              </tbody>
            </table>

            <h3 className="text-base font-semibold text-slate-900 mt-6 mb-2">Stack</h3>
            <p className="text-sm text-slate-700">
              Backend: Python, FastAPI, Groq SDK, Pydantic, Llama 3.3 70B.
              Frontend: React, Vite, Tailwind CSS.
              No agent framework — the pipeline is straightforward enough that adding one would've just been extra complexity for no gain.
            </p>
          </Card>
        )}
      </main>
    </div>
  )
}