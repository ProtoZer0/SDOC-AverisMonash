"""The orchestrator: one email in, one Case out.

Order is the order in docs/spec/pipeline.md — classify, gate, extract, compare,
score, decide. Nothing here reaches the network unless a document defeated every
deterministic path.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from uuid import NAMESPACE_URL, uuid5

from parsers.read import ParsedDocument, read as read_document
from pipeline import classify as classify_mod
from pipeline import crosscheck
from pipeline.compare import compare_documents
from pipeline.config import PIPELINE_VERSION, PROMPT_VERSION
from pipeline.gate import gate, role_of
from pipeline.report import decide, to_wire_reason
from pipeline.schemas import Case, ReviewItem, SourceDocument

_FIELD_LABEL = {
    "shipper": "shipper",
    "consignee": "consignee",
    "notify_party": "notify party",
    "port_of_loading": "port of loading",
    "port_of_discharge": "port of discharge",
    "container_count": "container count",
    "gross_weight_kg": "gross weight",
}


def process_email(
    email: dict,
    read_bytes,
    *,
    classify_llm=None,
    extract_fallback=None,
    circuit_breaker=None,
    intent_llm=None,
) -> tuple[Case, list[ReviewItem]]:
    started = time.perf_counter()
    now = datetime.now(timezone.utc)
    email_id = email["email_id"]
    correlation_id = str(uuid5(NAMESPACE_URL, f"protozero:{email_id}"))
    attachments = list(email.get("attachments") or [])

    guarded_classifier = _guarded(
        classify_llm, circuit_breaker, correlation_id, "classifier"
    )
    guarded_intent = _guarded(intent_llm, circuit_breaker, correlation_id, "intent")

    category, decided_by, confidence = classify_mod.classify(
        email.get("subject", ""),
        email.get("body", ""),
        email.get("from", ""),
        len(attachments),
        llm_fn=guarded_classifier,
    )

    case = Case(
        email_id=email_id,
        correlation_id=correlation_id,
        from_addr=email.get("from", ""),
        subject=email.get("subject", ""),
        category=category,
        decided_by=decided_by,
        category_confidence=confidence,
        pipeline_version=PIPELINE_VERSION,
        prompt_version=PROMPT_VERSION,
        created_at=now,
        updated_at=now,
    )

    if category != "BL_COMPARISON":
        case.status = "OK"
        case.summary = _non_comparison_summary(category)
        case.timings_ms = {"total": int((time.perf_counter() - started) * 1000)}
        return case, []

    # -- read every attachment once ---------------------------------------
    documents: dict[str, ParsedDocument] = {}
    for path in attachments:
        try:
            documents[path] = read_document(path, read_bytes(path))
        except Exception as exc:  # noqa: BLE001
            documents[path] = read_document(path, b"")
            documents[path].parse_error = f"{type(exc).__name__}: {exc}"
            documents[path].readable = False

    for path in attachments:
        doc = documents[path]
        case.documents.append(
            SourceDocument(
                attachment_path=path,
                role=role_of(path) or "SI",  # type: ignore[arg-type]
                detected_kind=doc.detected_kind,
                fmt=doc.fmt,
                readable=doc.readable,
                text_sha256=doc.text_sha256,
                page_count=doc.page_count,
                fields=doc.fields,
                parse_error=doc.parse_error,
            )
        )

    # -- gate --------------------------------------------------------------
    result = gate(attachments, email.get("body", ""), documents, guarded_intent)

    if not result.ok:
        # Last chance before escalating an unreadable document: the OCR /
        # Document Intelligence path. Injected, so the deterministic run needs
        # no cloud credentials at all.
        if (
            "UNREADABLE_DOCUMENT" in result.escalations
            and extract_fallback is not None
        ):
            try:
                recovered = _call_optional(
                    extract_fallback,
                    circuit_breaker,
                    correlation_id,
                    "extraction",
                    attachments,
                    documents,
                    read_bytes,
                )
            except Exception:  # noqa: BLE001 - deterministic review path remains available
                recovered = None
            if recovered:
                documents.update(recovered)
                case.models["ocr"] = "azure-document-intelligence"
                case.documents = [
                    SourceDocument(
                        attachment_path=path,
                        role=role_of(path) or "SI",  # type: ignore[arg-type]
                        detected_kind=documents[path].detected_kind,
                        fmt=documents[path].fmt,
                        readable=documents[path].readable,
                        text_sha256=documents[path].text_sha256,
                        page_count=documents[path].page_count,
                        fields=documents[path].fields,
                        parse_error=documents[path].parse_error,
                    )
                    for path in attachments
                ]
                result = gate(attachments, email.get("body", ""), documents, guarded_intent)

    if result.intent_source == "llm":
        case.models["intent"] = "azure-openai"

    if not result.ok and result.awaiting_documents:
        # The sender is asking for a draft to be ISSUED, not checked. There is
        # nothing to compare yet, so this closes cleanly rather than sitting in
        # a human's queue. The distinction between this and "the attachments
        # were dropped" is semantic, and it is the one place in the gate where
        # reading intent genuinely beats a rule.
        case.status = "OK"
        case.summary = result.detail + _intent_note(result)
        case.timings_ms = {"total": int((time.perf_counter() - started) * 1000)}
        return case, []

    if not result.ok:
        case.status = "NEEDS_REVIEW"
        case.escalation_reasons = result.escalations
        case.wire_review_reason = to_wire_reason(result.escalations)
        case.summary = result.detail + _intent_note(result)
        case.lifecycle = "in_review"
        case.timings_ms = {"total": int((time.perf_counter() - started) * 1000)}
        review = [
            ReviewItem(
                id=f"{email_id}:doc",
                email_id=email_id,
                fields=[],
                reason=result.escalations[0],
                reason_detail=result.detail,
                created_at=now,
            )
        ]
        return case, review

    si, bl = result.si, result.bl
    assert si is not None and bl is not None

    checks = crosscheck.pdf_cross_checks(
        bl.full_text,
        bl.fields.container_count.value,
        bl.fields.gross_weight_kg.value,
    )
    directness = {}
    if si.bag is not None and bl.bag is not None:
        for name in _FIELD_LABEL:
            directness[name] = min(
                si.bag.label_directness(name) or 1.0,
                bl.bag.label_directness(name) or 1.0,
            )

    case.comparisons = compare_documents(
        si.fields,
        bl.fields,
        si_fmt=si.fmt,
        bl_fmt=bl.fmt,
        si_text=si.full_text,
        bl_text=bl.full_text,
        cross_checks=checks,
        label_directness=directness,
    )

    status, defects, reasons = decide(case.comparisons, [])
    case.status = status  # type: ignore[assignment]
    case.defect_fields = defects  # type: ignore[assignment]
    case.has_defect = status == "MISMATCH"
    case.escalation_reasons = reasons
    case.wire_review_reason = (
        to_wire_reason(reasons) if status == "NEEDS_REVIEW" else None
    )
    case.summary = comparison_summary(case)
    case.lifecycle = "in_review" if status == "NEEDS_REVIEW" else "new"

    scanned = [role for role, doc in (("SI", si), ("BL", bl)) if doc.fmt == "scan_pdf"]
    if scanned:
        return _hold_scanned_case(case, scanned, si, bl, now, started)

    case.timings_ms = {"total": int((time.perf_counter() - started) * 1000)}

    return case, _review_items(case, now)


def _hold_scanned_case(case: Case, scanned, si, bl, now, started):
    candidates = [c.field for c in case.comparisons if c.verdict == "MISMATCH"]
    unread = [c.field for c in case.comparisons if c.verdict in ("ABSENT", "REVIEW")]
    confidences = [
        d.ocr_confidence
        for d in (si, bl)
        if d.fmt == "scan_pdf" and d.ocr_confidence is not None
    ]
    ocr_conf = min(confidences) if confidences else None
    which = " and ".join(
        {"SI": "shipping instruction", "BL": "draft bill of lading"}[r] for r in scanned
    )

    case.status = "NEEDS_REVIEW"
    case.has_defect = False
    case.defect_fields = []
    case.escalation_reasons = ["UNREADABLE_DOCUMENT", *case.escalation_reasons]
    case.wire_review_reason = to_wire_reason(case.escalation_reasons)
    case.lifecycle = "in_review"
    conf_note = f" (OCR confidence {ocr_conf:.0%})" if ocr_conf is not None else ""
    notes = []
    if candidates:
        notes.append(
            "reads a possible difference on "
            + ", ".join(_FIELD_LABEL[f] for f in candidates)
        )
    if unread:
        notes.append("could not read " + ", ".join(_FIELD_LABEL[f] for f in unread))
    if not notes:
        notes.append(f"reads all {len(case.comparisons)} fields as matching")
    diff_note = "OCR " + "; ".join(notes) + "."
    if len(scanned) == 1:
        doc_note = f"The {which} is a scanned image"
    else:
        doc_note = f"The {which} are scanned images"
    case.summary = (
        f"{doc_note}, read by Document Intelligence{conf_note}. "
        f"{diff_note} A person should confirm against the scan before acting."
    )
    case.timings_ms = {"total": int((time.perf_counter() - started) * 1000)}

    items = [
        ReviewItem(
            id=f"{case.email_id}:doc",
            email_id=case.email_id,
            fields=[],
            reason="UNREADABLE_DOCUMENT",
            reason_detail=case.summary,
            confidence=ocr_conf,
            created_at=now,
        )
    ]
    for c in case.comparisons:
        if c.verdict in ("MISMATCH", "ABSENT", "REVIEW") or c.confidence.hard_fail:
            reason = {
                "MISMATCH": "LOW_CONFIDENCE",
                "ABSENT": "FIELD_NOT_FOUND",
                "REVIEW": "BORDERLINE_MATCH",
            }.get(c.verdict, c.confidence.hard_fail or "LOW_CONFIDENCE")
            items.append(
                ReviewItem(
                    id=f"{case.email_id}:{c.field}",
                    email_id=case.email_id,
                    fields=[c.field],
                    reason=reason,
                    reason_detail="Read from a scan — " + c.explanation,
                    si_value=c.si.value,
                    bl_value=c.bl.value,
                    si_evidence=c.si.evidence,
                    bl_evidence=c.bl.evidence,
                    confidence=c.confidence.score,
                    created_at=now,
                )
            )
    return case, items


def _intent_note(result) -> str:
    if result.intent_source == "llm":
        return " (Request intent read by Azure OpenAI.)"
    return ""


def _guarded(operation, breaker, correlation_id: str, service: str):
    if operation is None:
        return None

    def call(*args, **kwargs):
        return _call_optional(
            operation, breaker, correlation_id, service, *args, **kwargs
        )

    return call


def _call_optional(operation, breaker, correlation_id: str, service: str, *args, **kwargs):
    if breaker is None:
        return operation(*args, **kwargs)
    return breaker.call(
        operation,
        *args,
        correlation_id=correlation_id,
        service=service,
        **kwargs,
    )


def _non_comparison_summary(category: str) -> str:
    return {
        "SI_REQUEST": "A request for a new Shipping Instruction — no comparison needed.",
        "INVOICE_QUERY": "An invoice or charges query — routed away from document checking.",
        "GENERAL": "An operational or automated notice — no action in this workflow.",
        "SPAM": "Unsolicited mail from an unrecognised sender domain.",
    }.get(category, "No comparison required.")


def comparison_summary(case: Case) -> str:
    if case.status == "OK":
        return "No mismatch detected. All seven fields agree with the Shipping Instruction."
    if case.status == "MISMATCH":
        names = ", ".join(_FIELD_LABEL[f] for f in case.defect_fields)
        parts = [
            c.explanation
            for c in case.comparisons
            if c.field in case.defect_fields
        ]
        return f"Mismatch on {names}. " + " ".join(parts)
    return "Needs review — " + "; ".join(
        c.explanation for c in case.comparisons
        if c.verdict in ("ABSENT", "REVIEW") or c.confidence.hard_fail
    )


def _review_items(case: Case, now) -> list[ReviewItem]:
    items: list[ReviewItem] = []
    for c in case.comparisons:
        reason = None
        if c.verdict == "ABSENT":
            reason = "FIELD_NOT_FOUND"
        elif c.verdict == "REVIEW":
            reason = "BORDERLINE_MATCH"
        elif c.confidence.hard_fail:
            reason = c.confidence.hard_fail
        if reason is None:
            continue
        items.append(
            ReviewItem(
                id=f"{case.email_id}:{c.field}",
                email_id=case.email_id,
                fields=[c.field],
                reason=reason,
                reason_detail=c.explanation,
                si_value=c.si.value,
                bl_value=c.bl.value,
                si_evidence=c.si.evidence,
                bl_evidence=c.bl.evidence,
                confidence=c.confidence.score,
                created_at=now,
            )
        )
    return items
