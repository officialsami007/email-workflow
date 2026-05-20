# Email Triage

Inbound customer emails for an industrial equipment distributor get classified, key fields extracted, routed to the right team, and (for sales-side enquiries) a short draft reply generated.

I built three versions of the same pipeline. Submit whichever fits the role — they all share the same logic and produce the same JSON shape.

| Version              | Folder                     | What it shows                              |
| -------------------- | -------------------------- | ------------------------------------------ |
| Python CLI           | `backend/`                 | Core pipeline, structured output, retries  |
| React UI + FastAPI   | `backend/` + `frontend/`   | Same logic with a clean demo interface     |
| n8n no-code workflow | `n8n/`                     | Same logic as a visual automation          |


## Running it

### Python + React UI (recommended for the demo)

Two terminals.

Backend:
```bash
cd backend
python -m venv venv && source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                               # Windows: copy .env.example .env
# open .env and set GROQ_API_KEY=...
uvicorn server:app --reload --port 8000
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. If the key is set you'll see "Backend ready" and can either run the 5 test emails or paste your own. Free Groq key: https://console.groq.com.

### Python only (no UI)

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# set GROQ_API_KEY in .env
python workflow.py
```

Prints a summary and writes `output.json`. CLI and server read the same `.env`.

### n8n version

`n8n/README.md` has the full walkthrough. Short version: run n8n in Docker, import the workflow JSON, add the Groq credential, activate, hit the webhook.


## What's in each file

### `backend/workflow.py`
The whole pipeline lives here. Everything else either calls into it or wraps it.

- `ExtractedFields`, `Classification` — Pydantic models that lock down the shape of the model's response. Wrong shape = ValidationError = retry.
- `CLASSIFY_SYSTEM` — the classification prompt. Five categories, fields to extract, the JSON shape, and the rules (don't guess, don't invent, low confidence means human review).
- `DRAFT_USER` — the reply-drafting prompt. Short, plain, no commitments on price or stock.
- `classify()` — one Groq call. Validates with Pydantic, retries once if parsing fails, falls back to "Unclear" if both attempts fail.
- `draft_reply()` — second Groq call for the 3-4 sentence acknowledgement.
- `ROUTES` — category → mock destination (email + Slack channel).
- `route()` — picks destination, adds extra actions for urgent emails, flags low-confidence cases.
- `process_one()` — wraps classify → route → maybe draft_reply in a try/except so one bad email doesn't kill the batch.
- `main()` — CLI entrypoint. Reads `emails.json`, processes all 5, writes `output.json`.

### `backend/server.py`
Thin FastAPI wrapper around `workflow.py`. Three endpoints:

- `GET /api/health` — `{status, api_key_configured}`. Frontend uses this to show the setup banner if the key is missing.
- `GET /api/samples` — returns the 5 test emails.
- `POST /api/classify` — takes a list of emails, runs `process_one` on each, returns results.

CORS is set up for the Vite dev server (5173).

### `backend/emails.json`
The 5 assessment test emails. Each has `id`, `subject`, `body`.

### `backend/.env.example`
Template. Copy to `.env` and paste your real key. The real `.env` is gitignored.

### `backend/requirements.txt`
`groq`, `pydantic`, `fastapi`, `uvicorn`, `python-dotenv`. That's it.

### `frontend/package.json`
React 18 + Vite + Tailwind. `npm install` and you're set.

### `frontend/index.html`
Root HTML. Loads the Inter font and mounts React.

### `frontend/src/main.jsx`
Three lines that render `<App />`.

### `frontend/src/App.jsx`
The whole UI in one file — easier to read top to bottom than splitting it up for this size.

- Constants — category colours, the 8 sample emails for the paste-and-try tab.
- Small components — `Card`, `CategoryBadge`, `ConfidenceIndicator`, `Stat`.
- `ResultCard` — one processed email: original on the left, category + extracted fields + routing actions + draft reply on the right.
- `EmailPreviewList` — expand-to-read preview so you can see the emails before hitting Run.
- `App` — three tabs:
  1. **Run on test emails** — fetches the 5 samples, runs them, shows summary stats and result cards.
  2. **Paste your own email** — textarea + 8 click-to-load samples covering all categories plus edge cases.
  3. **How it works** — explanation, routing table, stack.

### `frontend/src/index.css`
Tailwind base + body font.

### `frontend/vite.config.js`, `tailwind.config.js`, `postcss.config.js`
Stock Vite + Tailwind configs. Nothing custom.

### `n8n/email-triage-workflow.json`
The n8n workflow as importable JSON. 10 nodes:

1. Webhook (receives the email)
2. Groq HTTP request — classification
3. Code node — parses + validates + builds the routing decision
4. Switch — branches by category
5-8. Four branches: urgent alert, sales draft, service ticket, human review
9. Second Groq HTTP request — draft reply (sales branch only)
10. Respond — sends the final JSON back

### `n8n/README.md`
Import + Groq credential setup + how to test it with curl.


## Categories

| Category           | When it fires                                            | Routes to    |
| ------------------ | -------------------------------------------------------- | ------------ |
| Product Enquiry    | Customer asks about availability / specs / price         | Sales        |
| Service Request    | Customer needs a technician for existing equipment       | Service      |
| Quote Follow-up    | Customer references a prior quote                        | Sales        |
| Urgent Escalation  | "URGENT", "production down", "TODAY", emergency wording  | Ops alert    |
| Unclear            | Too vague to act on without guessing                     | Human review |


## Design choices worth defending

- **One LLM call per email, not two.** Category, extraction, urgency, and reasoning come back in one structured response. Half the cost, half the latency, one reasoning trace to debug.
- **Pydantic + one retry + fallback to Unclear.** Malformed model output can't crash the batch.
- **Confidence threshold at 0.6.** Even when a category is assigned, low confidence flags for human review.
- **Auto-draft only for sales-side categories.** A generic "we got your email" reply on a production-down ticket is worse than silence.
- **Per-email try/except.** One bad email doesn't stop the batch.
- **No agent framework.** Pipeline is linear — LangChain or LangGraph would add overhead without value. Same logic would port directly if the workflow grew to multi-step chains.


## On API keys

The Groq key sits in `backend/.env`, which is gitignored. The frontend never sees the key — it just calls the backend, which uses the key server-side. The app doesn't ask for your personal email anywhere; "email" in the code refers to the customer emails being processed.


## File tree

```
sami-email-workflow/
├── README.md                          ← this file
├── WRITEUP.md                         ← 1-page write-up
├── .gitignore                         ← keeps .env out of git
├── backend/
│   ├── workflow.py                    ← core pipeline
│   ├── server.py                      ← FastAPI server
│   ├── emails.json                    ← 5 test emails
│   ├── output.json                    ← results (regenerated on run)
│   ├── .env.example                   ← copy to .env, add your key
│   └── requirements.txt
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx                   ← React entry
│       ├── App.jsx                    ← the whole UI
│       └── index.css                  ← Tailwind base
└── n8n/
    ├── email-triage-workflow.json     ← importable n8n workflow
    └── README.md                      ← n8n setup steps
```