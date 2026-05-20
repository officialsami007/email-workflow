"""
Email triage pipeline.

For each email: one LLM call returns category + extracted fields + urgency in JSON.
Pydantic validates the response. Retries once on a parse failure, then falls back
to 'Unclear' so a malformed model output never kills the batch.

Can be run on its own (python workflow.py) or imported by server.py.
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import Literal, Optional

from groq import Groq
from pydantic import BaseModel, Field, ValidationError
from dotenv import load_dotenv


BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR / ".env")

MODEL = "llama-3.3-70b-versatile"


# ---- types ----

Category = Literal[
    "Product Enquiry",
    "Service Request",
    "Quote Follow-up",
    "Urgent Escalation",
    "Unclear",
]

Urgency = Literal["low", "medium", "high", "critical"]


class ExtractedFields(BaseModel):
    customer_name: Optional[str] = None
    contact_number: Optional[str] = None
    product_or_serial: Optional[str] = None
    location: Optional[str] = None
    urgency: Urgency = "low"


class Classification(BaseModel):
    category: Category
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    fields: ExtractedFields


# ---- prompts ----

CLASSIFY_SYSTEM = """You triage inbound customer emails for an industrial equipment distributor that serves oil & gas and semiconductor customers in Southeast Asia.

Classify the email into exactly ONE category:

- "Product Enquiry": customer is asking about availability, lead time, specs, or pricing of a product they want to buy.
- "Service Request": customer needs a technician, repair, calibration, or on-site work for equipment already in their facility.
- "Urgent Escalation": production-impacting failure, downtime, or explicit emergency language ("URGENT", "ASAP TODAY", "line down", "emergency"). Beats Service Request when both could apply.
- "Quote Follow-up": customer is chasing or referencing a prior quote (quote number, "following up on quote", "pricing changed").
- "Unclear": message is too vague, lacks context, or could be junk. Do NOT guess a category just to look helpful - if the email is one line with no product, no serial, no quote, no clear ask, it is Unclear.

Then extract these fields. Use null if the field is not in the email - never invent.

- customer_name: signed name only (not the company name).
- contact_number: phone number if present.
- product_or_serial: part description, serial number, or quote ID - whichever the customer mentions.
- location: city, region, or facility.
- urgency: one of "low" (general enquiry), "medium" (timeframe given, e.g. "2 weeks"), "high" (ASAP, urgent), "critical" (production down, today, emergency).

Return ONLY a JSON object in this exact shape - no markdown, no prose:

{
  "category": "<one of the five categories>",
  "confidence": <float between 0 and 1>,
  "reasoning": "<one short sentence citing the actual phrasing that drove the decision>",
  "fields": {
    "customer_name": <string or null>,
    "contact_number": <string or null>,
    "product_or_serial": <string or null>,
    "location": <string or null>,
    "urgency": "<low|medium|high|critical>"
  }
}

Rules:
- Confidence below 0.6 means human review even if a category is assigned.
- "Unclear" should generally have confidence below 0.5.
- Do not classify into Product Enquiry just because the email mentions "products" - there must be a specific item or ask.
"""

DRAFT_USER = """Draft a short, professional acknowledgement reply to this customer email.

Rules:
- 3 to 4 sentences. No filler.
- Reference this specific item: {reference}
- Confirm receipt and set expectation for the next step.
- Do NOT commit to prices, stock levels, or dates you cannot verify.
- Sign off as "Sales Team". Do not invent a personal name.
- Plain text. No subject line, no email headers.

Customer email:
\"\"\"
{email_body}
\"\"\"
"""


# ---- routing destinations (mocks for the assessment - swap for Slack/ticket APIs in prod) ----

ROUTES = {
    "Product Enquiry":   {"to": "sales-team@distributor.local",   "channel": "#sales-inbox"},
    "Service Request":   {"to": "service-team@distributor.local", "channel": "#service-tickets"},
    "Quote Follow-up":   {"to": "sales-team@distributor.local",   "channel": "#sales-inbox"},
    "Urgent Escalation": {"to": "ops-alerts@distributor.local",   "channel": "#ops-critical"},
    "Unclear":           {"to": "human-review@distributor.local", "channel": "#triage-queue"},
}


def _client(api_key: Optional[str] = None) -> Groq:
    key = api_key or os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY not set")
    return Groq(api_key=key)


def classify(client: Groq, email_body: str) -> Classification:
    # one shot, retry once if the model returns something we can't parse
    last_err = None
    for _ in range(2):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": CLASSIFY_SYSTEM},
                    {"role": "user", "content": email_body},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            return Classification.model_validate_json(resp.choices[0].message.content)
        except (ValidationError, json.JSONDecodeError) as e:
            last_err = e

    # both attempts failed - degrade gracefully instead of raising
    return Classification(
        category="Unclear",
        confidence=0.0,
        reasoning=f"Model output failed schema validation after retry: {type(last_err).__name__}",
        fields=ExtractedFields(),
    )


def draft_reply(client: Groq, email_body: str, reference: Optional[str]) -> str:
    ref = reference or "the item referenced in your email"
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "user", "content": DRAFT_USER.format(reference=ref, email_body=email_body)},
        ],
        temperature=0.3,
    )
    return resp.choices[0].message.content.strip()


def route(c: Classification) -> dict:
    target = ROUTES[c.category]
    actions = []

    if c.category == "Urgent Escalation":
        actions.append(f"PRIORITY=HIGH alert sent to {target['to']}")
        actions.append(f"Slack {target['channel']} pinged with @oncall")
    elif c.category == "Unclear":
        actions.append(f"Queued for human review at {target['to']}")
    else:
        actions.append(f"Forwarded to {target['to']} (Slack {target['channel']})")

    # even when a category is assigned, flag low-confidence ones for a human
    if c.confidence < 0.6 and c.category != "Unclear":
        actions.append("Low-confidence flag set - secondary review by triage analyst")

    return {
        "destination": target["to"],
        "channel": target["channel"],
        "actions": actions,
    }


def process_one(client: Groq, email: dict) -> dict:
    out = {
        "id": email.get("id", "custom"),
        "subject": email.get("subject", ""),
        "body": email["body"],
        "processed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    # wrapped in try/except so one bad email doesn't kill the whole batch
    try:
        c = classify(client, email["body"])
        out["classification"] = c.model_dump()
        out["routing"] = route(c)

        # only auto-draft for sales-side categories
        # generic "we got your email" reply on a production-down ticket is worse than silence
        if c.category in ("Product Enquiry", "Quote Follow-up"):
            out["draft_reply"] = draft_reply(client, email["body"], c.fields.product_or_serial)
        else:
            out["draft_reply"] = None

        out["status"] = "ok"

    except Exception as e:
        out["status"] = "error"
        out["error"] = f"{type(e).__name__}: {e}"
        out["classification"] = None
        out["routing"] = {
            "destination": "human-review@distributor.local",
            "channel": "#triage-queue",
            "actions": ["Pipeline error - sent to human queue"],
        }
        out["draft_reply"] = None

    return out


def main():
    emails = json.loads((BASE_DIR / "emails.json").read_text())

    try:
        client = _client()
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    results = [process_one(client, e) for e in emails]
    (BASE_DIR / "output.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))

    # quick readable summary
    print(f"\nProcessed {len(results)} emails")
    print("=" * 60)
    for r in results:
        c = r.get("classification") or {}
        print(f"\n[{r['id']}] {c.get('category', 'ERROR')} (conf={c.get('confidence', 0):.2f})")
        print(f"  -> {r['routing']['destination']}")
        for a in r["routing"]["actions"]:
            print(f"  - {a}")


if __name__ == "__main__":
    main()