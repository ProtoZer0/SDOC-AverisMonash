"""Stage 2 — decide whether a comparison is POSSIBLE before attempting one.

Every check here is deterministic. Escalation is cheap at this stage and
expensive later: once both documents have parsed cleanly, escalating a real
mismatch turns a caught defect into a miss. So — escalate freely when documents
are missing, unreadable or blank; escalate reluctantly once they have parsed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field as dc_field

from parsers.doctype import DECOY_KINDS
from parsers.read import ParsedDocument
from pipeline.schemas import EscalationReason

_ASKS_TO_COMPARE = re.compile(
    r"\b(compare|check|verify|confirm|cross[- ]check)\b", re.I
)
_ASKS_TO_SEND = re.compile(
    r"\b(assist to send|please send|kindly send|send (?:me|us|the)|issue|prepare|provide|share)\b",
    re.I,
)


@dataclass
class GateResult:
    ok: bool
    escalations: list[EscalationReason] = dc_field(default_factory=list)
    detail: str = ""
    si: ParsedDocument | None = None
    bl: ParsedDocument | None = None
    si_path: str | None = None
    bl_path: str | None = None
    awaiting_documents: bool = False
    intent_source: str | None = None
    intent_reason: str | None = None


def role_of(path: str) -> str | None:
    """From the filename — PAIRING ONLY. Never the document type."""
    stem = path.rsplit("/", 1)[-1].rsplit(".", 1)[0].upper()
    if stem.endswith("_SI"):
        return "SI"
    if stem.endswith("_BL"):
        return "BL"
    return None


def wants_comparison_now(body: str) -> bool:
    """'Compare these' versus 'please send me one'.

    A comparison email with no attachments is genuinely ambiguous: it is either
    a request that cannot proceed yet (nothing to compare) or a request whose
    attachments went missing. The body is the only discriminator in the data,
    and it is a semantic one — which is exactly where the model earns its place.
    """
    if _ASKS_TO_COMPARE.search(body or "") and not _ASKS_TO_SEND.search(body or ""):
        return True
    if re.search(r"attachments?\s+(?:appear|seem)?\s*to\s+have\s+been\s+dropped", body or "", re.I):
        return True
    return False


def read_intent(body: str, intent_fn=None) -> tuple[bool, str, str | None]:
    if intent_fn is not None:
        try:
            intent, confidence, reason = intent_fn(body)
            if intent == "SEND" and confidence >= 0.6:
                return False, "llm", reason
            return True, "llm", reason
        except Exception:  # noqa: BLE001
            pass
    return wants_comparison_now(body), "rule", None


def gate(
    attachments: list[str],
    body: str,
    documents: dict[str, ParsedDocument],
    intent_fn=None,
) -> GateResult:
    paths = {role_of(p): p for p in attachments if role_of(p)}

    # --- 1. Pair ---------------------------------------------------------
    if len(attachments) == 0:
        compare_now, source, reason = read_intent(body, intent_fn)
        if compare_now:
            return GateResult(
                ok=False,
                escalations=["MISSING_ATTACHMENT"],
                detail="The sender asks for a comparison but no documents are attached.",
                intent_source=source,
                intent_reason=reason,
            )
        return GateResult(
            ok=False,
            escalations=["MISSING_ATTACHMENT"],
            detail="No documents yet — the sender is asking for a draft to be issued.",
            awaiting_documents=True,
            intent_source=source,
            intent_reason=reason,
        )

    if len(attachments) < 2 or "SI" not in paths or "BL" not in paths:
        have = ", ".join(sorted(paths)) or "none"
        return GateResult(
            ok=False,
            escalations=["MISSING_ATTACHMENT"],
            detail=f"Only one document was attached (have: {have}); a comparison needs both.",
        )

    si = documents.get(paths["SI"])
    bl = documents.get(paths["BL"])

    # --- 2. Open ---------------------------------------------------------
    unreadable = [
        (role, doc)
        for role, doc in (("SI", si), ("BL", bl))
        if doc is None or not doc.readable
    ]
    if unreadable:
        names = ", ".join(role for role, _ in unreadable)
        reason = (unreadable[0][1].parse_error if unreadable[0][1] else "not parsed")
        return GateResult(
            ok=False,
            escalations=["UNREADABLE_DOCUMENT"],
            detail=f"Could not read the {names} document ({reason}).",
            si=si,
            bl=bl,
            si_path=paths["SI"],
            bl_path=paths["BL"],
        )

    # --- 3. Sniff type ---------------------------------------------------
    kinds = {"SI": si.detected_kind, "BL": bl.detected_kind}
    if kinds["SI"] != "SI" or kinds["BL"] != "BL":
        wrong = [
            f"the {role} attachment reads as {kind.replace('_', ' ').lower()}"
            for role, kind in kinds.items()
            if kind != role
        ]
        decoy = any(k in DECOY_KINDS for k in kinds.values())
        return GateResult(
            ok=False,
            escalations=["WRONG_DOC_TYPE"],
            detail=(
                "; ".join(wrong)
                + ("." if decoy else " — the filename says otherwise.")
            ),
            si=si,
            bl=bl,
            si_path=paths["SI"],
            bl_path=paths["BL"],
        )

    return GateResult(
        ok=True, si=si, bl=bl, si_path=paths["SI"], bl_path=paths["BL"]
    )
