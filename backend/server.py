"""
FastAPI backend for the email triage app.
Wraps the pipeline in workflow.py and exposes it to the React frontend.
"""

import os
import json
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

from workflow import _client, process_one


# load .env so we can pick up GROQ_API_KEY
BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR / ".env")


app = FastAPI(title="AI Email Triage API")

# frontend runs on vite (5173) during dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://email-workflow-ten.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


# request/response shapes
class EmailIn(BaseModel):
    id: Optional[str] = None
    subject: Optional[str] = ""
    body: str


class ClassifyRequest(BaseModel):
    emails: List[EmailIn]


@app.get("/api/health")
def health():
    # frontend uses this to check if the key is set before showing the warning banner
    return {
        "status": "ok",
        "api_key_configured": bool(os.getenv("GROQ_API_KEY")),
    }


@app.get("/api/samples")
def samples():
    # the 5 test emails from the assessment
    return json.loads((BASE_DIR / "emails.json").read_text())


@app.post("/api/classify")
def classify_emails(req: ClassifyRequest):
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY not set. Add it to backend/.env and restart.",
        )

    try:
        client = _client(key)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    results = []
    for i, email in enumerate(req.emails):
        payload = {
            "id": email.id or f"email_{i + 1}",
            "subject": email.subject or "",
            "body": email.body,
        }
        results.append(process_one(client, payload))

    return {"results": results, "count": len(results)}