# Write-up — AI Email Triage Workflow

## Approach

Three implementations of the same pipeline, sharing a single core. The Python module `workflow.py` does the actual work — one LLM call per email returns classification, extracted fields, urgency, and reasoning in one structured JSON response. Pydantic validates that response, retries once on a parse failure, and falls back to "Unclear" if both attempts fail, so the batch never crashes. Around this core sit three surfaces: a CLI script for batch processing, a FastAPI server + React UI for interactive demos and operator use, and an n8n workflow for teams that prefer no-code automation.

I combined classification and field extraction into one prompt rather than chaining two calls. For a real batch this halves token spend and roughly halves latency. The trade-off is that a parse failure costs more, which is why there is a retry plus graceful fallback rather than letting the exception bubble up.

## Tools

- Python 3.11, Groq SDK, Pydantic 2, FastAPI, Uvicorn (backend)
- React 18, Vite, Tailwind CSS (UI)
- n8n via Docker (no-code version)
- Llama 3.3 70B via Groq, JSON mode, temperature 0.1 for classification and 0.3 for drafts
- No agent framework — the pipeline is linear, two LLM calls per sales-side email, one call otherwise. Same logic would map directly to LangChain's `with_structured_output` if the workflow grew to multi-step chains, but the framework overhead was not worth it here.

## Key design decisions

- **One prompt does classification + extraction + urgency.** Lower latency, lower cost, single reasoning trace to debug.
- **Confidence threshold at 0.6.** Anything below that gets a low-confidence flag for human review even if a category was assigned. The prompt explicitly tells the model not to guess to look helpful — this is what keeps Email 4 in "Unclear" instead of being forced into Product Enquiry on the word "products".
- **Auto-draft is intentionally scoped to Product Enquiry and Quote Follow-up.** A generic acknowledgement on a production-down ticket is worse than silence; it sets a wrong expectation while the real response is delayed. Service Requests and Urgent Escalations need a human in the loop.
- **Urgent Escalation beats Service Request when both could apply.** Email 5 needs both a technician and an escalation, but ops-alerts has the tighter SLA, so that is where it routes.
- **Per-email try/except.** One bad email cannot kill the batch — errored emails get routed to the human queue with the error logged.
- **API key only lives in the browser session.** The React UI sends it to the backend per request and never stores it. No personal data is collected.

## Assumptions

- Plain text emails. No attachments, threading, or quoted reply chains.
- Mock destinations are written as email addresses for readability. In production these become Slack webhook URLs, ticket system endpoints, or CRM API calls.
- Self-reported confidence from the model is approximate, not calibrated.

## What I would improve with more time

1. **Real integrations.** Slack webhook for `#ops-critical`, ticket creation in the CRM/ITSM, IMAP poller or webhook receiver instead of a JSON file.
2. **Few-shot examples in the prompt.** I tested with the 5 sample emails. Production needs 30–50 labelled historical examples to lock down edge cases: spam, multi-intent emails, and the mixed Bahasa Malaysia / English realistic given the Penang reference.
3. **Eval harness.** A proper version logs predictions vs. ground truth and tracks per-category precision and recall, especially recall on Urgent Escalation and false positives on Unclear.
4. **Product / quote lookup.** Extraction captures the raw string (`QT-4821`, `FC-2291`). Next step is wiring this to the product catalogue and quote DB so the draft can reference real lead times instead of generic acknowledgements.
5. **Confidence calibration.** Llama's self-reported confidence is rough. I would replace it with a small classifier on the labelled historical set, or use token-level logprobs from the model.
6. **Cost ceiling.** No per-day token budget right now. For a real inbox, I would add a daily cap with a circuit breaker that falls back to rule-based triage if exceeded.
