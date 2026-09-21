from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field

from pipeline import config

if not config.azure_openai_configured():
    raise ImportError("Azure OpenAI is not configured")

from openai import AzureOpenAI  # noqa: E402

_client = AzureOpenAI(
    azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
    api_key=config.AZURE_OPENAI_API_KEY,
    api_version=config.AZURE_OPENAI_API_VERSION,
    timeout=config.AI_TIMEOUT_S,
    max_retries=4,
)

DEPLOYMENT = config.AZURE_OPENAI_DEPLOYMENT_CLASSIFY

Category = Literal["BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM"]
Intent = Literal["COMPARE", "SEND", "UNCLEAR"]


class ClassifyOut(BaseModel):
    category: Category
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str


class IntentOut(BaseModel):
    intent: Intent
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str


def _schema(name: str, enum_key: str, values: list[str]) -> dict:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": name,
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    enum_key: {"type": "string", "enum": values},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": [enum_key, "confidence", "reason"],
                "additionalProperties": False,
            },
        },
    }


FORMATS = {
    "classify": _schema(
        "email_category",
        "category",
        ["BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM"],
    ),
    "intent": _schema("request_intent", "intent", ["COMPARE", "SEND", "UNCLEAR"]),
}

CLASSIFY_PROMPT = """You triage a shipping documentation inbox. Put the email in exactly one category.

BL_COMPARISON  The sender wants a draft Bill of Lading checked against a Shipping Instruction, or confirmed.
SI_REQUEST     The sender needs a new Shipping Instruction prepared or sent.
INVOICE_QUERY  Billing, charges, invoices, debit or credit notes, cancellations of an invoice.
GENERAL        Operational updates, automated reports, reminders, HR or holiday notices.
SPAM           Unsolicited, promotional, phishing, prize, crypto or credential-harvesting mail.

Judge by what the sender is asking for, not by which nouns appear. An email that
mentions "SI" or "BL" is not automatically about either. An unfamiliar sender
domain is a weak signal on its own: new customers write from new domains.
Return a confidence between 0 and 1 and a one-sentence reason."""

INTENT_PROMPT = """A shipping operations team received an email about a draft Bill of Lading with NO attachments.
Decide what the sender is asking the team to do.

COMPARE  The sender wants documents checked or confirmed now, which means the attachments
         they meant to include are missing and someone must ask for them.
SEND     The sender is asking the team to prepare, issue or send a draft; nothing exists yet to check.
UNCLEAR  The email does not say which.

Answer from the request itself. Ignore signatures, disclaimers and warning banners.
Return a confidence between 0 and 1 and a one-sentence reason."""


def classify_with_llm(
    subject: str, body: str, sender_domain: str, n_attachments: int
) -> tuple[str, float]:
    user = (
        f"Sender domain: {sender_domain or 'unknown'}\n"
        f"Attachments: {n_attachments}\n"
        f"Subject: {subject}\n\n"
        f"Body (first 800 characters):\n{body[:800]}"
    )
    out = ClassifyOut.model_validate(_ask("classify", CLASSIFY_PROMPT, user))
    return out.category, round(out.confidence, 3)


def intent_with_llm(body: str) -> tuple[str, float, str]:
    out = IntentOut.model_validate(_ask("intent", INTENT_PROMPT, f"Email body:\n{body[:1200]}"))
    return out.intent, round(out.confidence, 3), out.reason


def _ask(kind: str, system: str, user: str) -> dict:
    key = hashlib.sha256(
        f"{config.PROMPT_VERSION}|{DEPLOYMENT}|{kind}|{user}".encode()
    ).hexdigest()
    return json.loads(_cached(key, kind, system, user))


@lru_cache(maxsize=4096)
def _cached(key: str, kind: str, system: str, user: str) -> str:
    resp = _client.chat.completions.create(
        model=DEPLOYMENT,
        temperature=config.TEMPERATURE,
        response_format=FORMATS[kind],
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content or "{}"
