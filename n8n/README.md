# n8n Version of the Email Triage Workflow

Same logic as the Python pipeline, built as an n8n workflow. Import the JSON, add your Groq credential, activate.

## Import steps

1. **Run n8n locally** (Docker is easiest):
   ```bash
   docker run -it --rm --name n8n -p 5678:5678 -v ~/.n8n:/home/node/.n8n docker.n8n.io/n8nio/n8n
   ```
   Open http://localhost:5678 in your browser.

2. **Import the workflow:**
   - In n8n, click the menu → **Import from File**
   - Select `email-triage-workflow.json`
   - The workflow appears on the canvas

3. **Add your Groq API key credential:**
   - In n8n, go to **Credentials** → **Add credential** → search for "Header Auth"
   - Name: `Groq API Header Auth`
   - Header Name: `Authorization`
   - Header Value: `Bearer YOUR_GROQ_API_KEY` (get the key at console.groq.com)
   - Save
   - Back in the workflow, on the two **Groq** nodes (Classify and Draft Reply), select this credential

4. **Activate the workflow** using the toggle at the top right.

## Test it

Once active, n8n exposes a webhook URL. Send any of the sample emails:

```bash
curl -X POST http://localhost:5678/webhook/email-triage \
  -H "Content-Type: application/json" \
  -d '{
    "id": "email_5",
    "subject": "URGENT - production line down",
    "body": "URGENT — production line down. The pressure relief valve you supplied last month has failed. Need emergency replacement or technician TODAY. Contact: Ahmad, 012-3456789"
  }'
```

The response is the same JSON shape as the Python version.

## Workflow structure

```
Webhook
  ↓
Groq: Classify          (LLM call returns category + extracted fields + urgency)
  ↓
Parse + Route           (validates JSON, builds routing decision, falls back to Unclear on error)
  ↓
Switch by Category
  ├─ Urgent     → Send Urgent Alert (mock) → Respond
  ├─ Sales      → Groq: Draft Reply → Attach Draft → Respond
  ├─ Service    → Service Ticket (mock) → Respond
  └─ Unclear    → Human Review (mock) → Respond
```

The mock destination nodes are JavaScript Code nodes that just `console.log` the action.
In production they would be:

- **Send Urgent Alert** → real Slack node or PagerDuty webhook
- **Service Ticket** → real ticketing system node (Jira, Zendesk, ServiceNow)
- **Human Review** → email node or another Slack node

## How this maps to the Python version

| Python pipeline                  | n8n equivalent                          |
| -------------------------------- | --------------------------------------- |
| `classify()` function            | "Groq: Classify" HTTP Request node      |
| Pydantic validation              | "Parse + Route" Code node (try/catch)   |
| Fallback to Unclear on parse fail| Same try/catch inside Parse + Route     |
| `route()` function               | Same Code node builds the routing dict  |
| `if category in (...)` for draft | Switch node + dedicated Sales branch    |
| `draft_reply()` function         | "Groq: Draft Reply" HTTP Request node   |
| Print summary                    | Respond node returns the final JSON     |
