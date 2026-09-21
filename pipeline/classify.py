"""Stage 1 — classify the email.

Rules first, LLM only for what the rules don't reach. Classification is 30% of
the organisers' score and is essentially a solved rules problem on this corpus,
so the model budget belongs downstream.

Where possible the rules key on GRAMMAR, not literal subject strings: the real
signal separating a comparison request from an SI request is the verb — "check
these documents" versus "send me a document". A rule keyed on the verb survives
a new subject template; one keyed on "TO CONFIRM DOCS" does not.
"""

from __future__ import annotations

import functools
import re

import yaml

from pipeline.config import DATA_REFS, RULE_CONFIDENCE
from pipeline.schemas import Category, DecidedBy

# --------------------------------------------------------------------------
# Preprocessing
# --------------------------------------------------------------------------

_BANNER = re.compile(
    r"^\s*(?:\[?EXTERNAL\]?\s*)?WARNING:\s*This (?:e-?mail|message) originated"
    r".*?(?:\n\s*\n|\Z)",
    re.I | re.S | re.M,
)
_REPLY_PREFIX = re.compile(r"^\s*(RE|FW|FWD)\s*[:_]\s*", re.I)


def strip_banner(body: str) -> str:
    """Remove the external-sender warning banner.

    Required, not cosmetic: the banner contains the word "attach" and fires
    naive attachment-mention heuristics on 27 emails in the sample inbox.
    """
    if not body:
        return ""
    cleaned = _BANNER.sub("", body)
    if cleaned != body:
        return cleaned.strip()
    # Fallback for banners that don't end in a blank line: drop the line itself.
    lines = [
        ln
        for ln in body.splitlines()
        if not re.match(r"\s*(?:\[?EXTERNAL\]?\s*)?WARNING:\s*This (?:e-?mail|message) originated", ln, re.I)
    ]
    return "\n".join(lines).strip()


def clean_subject(subject: str) -> str:
    s = subject or ""
    while True:
        new = _REPLY_PREFIX.sub("", s, count=1)
        if new == s:
            break
        s = new
    return s.strip()


def sender_domain(from_addr: str) -> str:
    return (from_addr or "").split("@")[-1].strip().lower()


@functools.lru_cache(maxsize=1)
def _domains() -> tuple[frozenset[str], frozenset[str]]:
    raw = yaml.safe_load((DATA_REFS / "sender_domains.yaml").read_text(encoding="utf-8"))
    return (
        frozenset(d.lower() for d in raw.get("corporate", [])),
        frozenset(d.lower() for d in raw.get("known_spam", [])),
    )


# --------------------------------------------------------------------------
# Rule layer
# --------------------------------------------------------------------------

# Bot / HR notices. Checked BEFORE invoice patterns: "_RPA_ India HSS SD
# Billing Process Completed" contains "Billing" but is a bot notice.
_GENERAL_SUBJECT = re.compile(
    r"(_RPA_|_Reminder_Paper|_Approval Required_|UPDATE SUMMARY|"
    r"daily Berthing Report|Pending BL Release|List of Outstanding BL|"
    r"Miss ?Connection|Delivery planning|Public Holiday|Annual Leave)",
    re.I,
)

_COMPARISON_SUBJECT = re.compile(
    r"^(TO CONFIRM DOCS|REQUEST BL DRAFT|DRAFT BL(?![A-Za-z0-9])|CONFIRM DRAFT BL|CHECK DOCS)",
    re.I,
)
# The coded carrier form: AIE - <POD> - <CARRIER>(<BL#>) - ...
_COMPARISON_CODED = re.compile(r"^(AIE|AFEMY|AFRT|AFPTME|AF[A-Z]{2,})\s*-\s*", re.I)

# Not \b: '_' is a word character, and it is this corpus's field separator, so
# \b never matches in "SI NEEDED_ 5APH-26773". The lookahead still rejects a
# longer word ("NEW SIGNATURE").
_SI_REQUEST_SUBJECT = re.compile(
    r"^(CUST SI|REQUEST SI|SI NEEDED|NEW SI)(?![A-Za-z0-9])", re.I
)
_SI_REQUEST_CODED = re.compile(r"^SI\s*-\s*\S+\s*-\s*DIRECT\s*\(", re.I)

_INVOICE_SUBJECT = re.compile(
    r"(RAK BILLING|MISSING GR\b|REQUEST TO CANCEL INVOICE|LOCAL CHARGES|"
    r"D\s*&\s*D charges|Total Freight|DEBIT NOTE|CREDIT NOTE|INVOICE)",
    re.I,
)

# Verb-level signals, used when no subject template matches. These carry the
# grammar rather than the wording, so they survive a template change.
_ASK_TO_COMPARE = re.compile(
    r"\b(compare|check|verify|confirm|cross[- ]check|review)\b[^.]{0,60}"
    r"\b(si|s/i|shipping instruction|draft bl|b/l|bill of lading|docs?|documents?)\b",
    re.I,
)
_ASK_TO_SEND = re.compile(
    r"\b(send|issue|prepare|provide|assist to send|share|release)\b[^.]{0,60}"
    r"\b(si|s/i|shipping instruction|draft bl|b/l|bill of lading)\b",
    re.I,
)


def is_unknown_domain(from_addr: str) -> bool:
    domain = sender_domain(from_addr)
    corporate, known_spam = _domains()
    return bool(domain) and domain not in corporate and domain not in known_spam


def classify_rules(
    subject: str,
    body: str,
    from_addr: str,
    n_attachments: int,
    llm_available: bool = False,
) -> tuple[Category, float] | None:
    """First match wins. Returns None when nothing matches (caller falls back)."""
    domain = sender_domain(from_addr)
    corporate, known_spam = _domains()

    if domain and domain in known_spam:
        return "SPAM", RULE_CONFIDENCE

    if domain and domain not in corporate:
        if llm_available:
            return None
        return "SPAM", RULE_CONFIDENCE

    subj = clean_subject(subject)
    clean_body = strip_banner(body)

    # 2. Comparison request.
    if _COMPARISON_SUBJECT.search(subj) or _COMPARISON_CODED.search(subj):
        return "BL_COMPARISON", RULE_CONFIDENCE

    # 3. SI request.
    if _SI_REQUEST_CODED.search(subj) or _SI_REQUEST_SUBJECT.search(subj):
        return "SI_REQUEST", RULE_CONFIDENCE

    # 4. Bot / HR notices — before invoice, deliberately.
    if _GENERAL_SUBJECT.search(subj):
        return "GENERAL", RULE_CONFIDENCE

    # 5. Invoice queries.
    if _INVOICE_SUBJECT.search(subj):
        return "INVOICE_QUERY", RULE_CONFIDENCE

    # 6. Grammar fallback, still deterministic. Attachments plus a
    #    "compare these" verb is a comparison request whatever the subject says.
    if n_attachments >= 1 and _ASK_TO_COMPARE.search(clean_body):
        return "BL_COMPARISON", 0.80
    if _ASK_TO_COMPARE.search(clean_body) and not _ASK_TO_SEND.search(clean_body):
        return "BL_COMPARISON", 0.70
    if _ASK_TO_SEND.search(clean_body) and re.search(r"\bSI\b|shipping instruction", clean_body, re.I):
        return "SI_REQUEST", 0.70

    return None


def classify(
    subject: str,
    body: str,
    from_addr: str,
    n_attachments: int,
    llm_fn=None,
) -> tuple[Category, DecidedBy, float]:
    """Rule layer, then optional LLM fallback.

    `llm_fn(subject, body, domain, n_attachments) -> (Category, confidence)`
    is injected so the pipeline runs with no cloud dependency at all.
    """
    hit = classify_rules(
        subject, body, from_addr, n_attachments, llm_available=llm_fn is not None
    )
    if hit is not None:
        return hit[0], "rule", hit[1]

    if llm_fn is not None:
        try:
            category, conf = llm_fn(
                clean_subject(subject),
                strip_banner(body)[:800],
                sender_domain(from_addr),
                n_attachments,
            )
            return category, "llm", conf
        except Exception:  # noqa: BLE001 — never let the model break the run
            if is_unknown_domain(from_addr):
                return "SPAM", "rule", RULE_CONFIDENCE

    # Last resort. GENERAL is the safe default: it is the category with no
    # downstream action, so a wrong guess here costs macro-F1 but never turns
    # into a false "all clear" on a document.
    return "GENERAL", "rule", 0.30
