"""FastAPI surface. Shapes are defined in docs/contracts.md §6."""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Literal

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from api.store import STORE
from api.all_cases_excel import build_all_cases_workbook
from api.case_report_pdf import build_case_report_pdf
from eval.run_eval import Inbox
from pipeline.config import DEFAULT_SOURCE, PIPELINE_VERSION
from pipeline.config import (
    INGEST_WORKERS,
    ENABLE_DOCINTEL,
    ENABLE_LLM,
    azure_openai_configured,
    docintel_configured,
)
from pipeline.circuit_breaker import CircuitBreaker
from pipeline.compare import recompare_with_correction
from pipeline.report import decide, to_submission_entry, to_wire_reason
from pipeline.run import comparison_summary, process_email
from pipeline.schemas import (
    FIELD_NAMES,
    AuditEvent,
    Case,
    CaseDecision,
    Correction,
    ReviewItem,
)
from parsers.read import read as read_document

logger = logging.getLogger("protozero.api")

_EXPORT_CACHE_TTL_SECONDS = 300
_EXPORT_CACHE_MAX_ITEMS = 8
_EXPORT_CACHE: dict[tuple, tuple[float, bytes]] = {}
_EXPORT_CACHE_LOCK = Lock()

app = FastAPI(title="ProtoZero — Shipping Document Verification", version=PIPELINE_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_inbox = Inbox(DEFAULT_SOURCE)
AI_BREAKER = CircuitBreaker()

# Optional adapters are discovered at startup. Their absence is a supported
# operating mode, not a boot failure.
try:
    from pipeline.azure_llm import classify_with_llm as _classify_llm
    from pipeline.azure_llm import intent_with_llm as _intent_llm
except Exception:  # noqa: BLE001 - optional adapter absence must not block startup
    _classify_llm = None
    _intent_llm = None

try:
    from pipeline.azure_docintel import extract_with_docintel as _extract_fallback
except Exception:  # noqa: BLE001 - optional adapter absence must not block startup
    _extract_fallback = None


class IngestRequest(BaseModel):
    email_ids: list[str] | None = None


class ResolveReviewRequest(BaseModel):
    action: Literal["confirm", "correct"]
    field: str | None = None
    correct_value: str | None = None
    document_role: Literal["SI", "BL"] = "BL"
    reviewer_id: str = "review-desk"


class RetryReviewRequest(BaseModel):
    force_llm: bool = False


class CaseDecisionRequest(BaseModel):
    action: Literal["approve", "reject", "review", "request"]
    label: str
    done: str
    reviewer_id: str = "review-desk"


class CaseWorkflowRequest(BaseModel):
    assigned_to: str | None = None
    review_status: Literal["unassigned", "assigned", "in_progress", "completed"]
    reviewer_id: str = "review-desk"


# Set when the warm start fails. Surfaced in `/` and `/api/health` because
# log streaming is unavailable on Container Apps express environments — if
# something goes wrong at boot, the response body has to say so.
WARM_START_ERROR: str | None = None
_LOADED = False


def ensure_loaded() -> None:
    """Populate the store on first read if the warm start didn't manage it.

    Belt and braces: the whole inbox takes under half a second, so paying that
    once on a cold request is far better than a judge opening the URL and
    finding an empty case list.
    """
    global _LOADED, WARM_START_ERROR
    if _LOADED or STORE.cases:
        _LOADED = True
        return
    try:
        ingest(IngestRequest())
        WARM_START_ERROR = None
    except Exception as exc:  # noqa: BLE001
        WARM_START_ERROR = f"{type(exc).__name__}: {exc}"
    finally:
        _LOADED = True


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Process the bundled inbox once at boot.

    A judge opening the URL should land on a populated case list, not an empty
    one waiting for someone to POST to /ingest.
    """
    ensure_loaded()
    yield


app.router.lifespan_context = lifespan


@app.get("/api")
def root() -> dict:
    """Service metadata. The built web application is served at `/`."""
    ensure_loaded()
    return {
        "service": "ProtoZero \u2014 Shipping Document Verification",
        "version": PIPELINE_VERSION,
        "cases_loaded": len(STORE.cases),
        "warm_start_error": WARM_START_ERROR,
        "dataset": DEFAULT_SOURCE,
        "docs": "/docs",
        "endpoints": [
            "/api/health",
            "/api/cases",
            "/api/cases/{email_id}",
            "/api/cases/export.xlsx",
            "/api/cases/{email_id}/events",
            "/api/cases/{email_id}/report.pdf",
            "/api/cases/{email_id}/document/{role}",
            "/api/review",
            "/api/metrics",
            "/api/submission",
        ],
    }


@app.get("/api/health")
def health() -> dict:
    ensure_loaded()
    classifier_ai = ENABLE_LLM and azure_openai_configured() and _classify_llm is not None
    extraction_ai = ENABLE_DOCINTEL and docintel_configured() and _extract_fallback is not None
    ai_available = classifier_ai or extraction_ai
    deterministic_only = AI_BREAKER.state == "open" or not ai_available
    classifier_state = "offline" if AI_BREAKER.state == "open" or not classifier_ai else "online"
    extraction_state = "offline" if AI_BREAKER.state == "open" or not extraction_ai else "online"
    return {
        "status": "degraded" if AI_BREAKER.state == "open" else "ok",
        "cases": len(STORE.cases),
        "version": PIPELINE_VERSION,
        "warm_start_error": WARM_START_ERROR,
        "mode": "deterministic_only" if deterministic_only else "full",
        "circuit_breaker": AI_BREAKER.state,
        "ai_failures": AI_BREAKER.failures,
        "components": [
            {"name": "classifier", "state": classifier_state},
            {"name": "extraction", "state": extraction_state},
            {"name": "deterministic_rules", "state": "online"},
            {"name": "comparison", "state": "online"},
            {"name": "audit_log", "state": "online"},
        ],
    }


@app.post("/api/ingest")
def ingest(req: IngestRequest) -> dict:
    import time

    started = time.perf_counter()
    emails = _inbox.emails()
    if req.email_ids:
        wanted = set(req.email_ids)
        emails = [e for e in emails if e["email_id"] in wanted]

    def run_one(email: dict):
        # Read the breaker inside the worker: with the pool running, a state
        # captured before the pool would belong to no case in particular.
        breaker_before = AI_BREAKER.state
        previous_case = STORE.get_case(email["email_id"])
        case, reviews = process_email(
            email,
            _inbox.read_bytes,
            classify_llm=_classify_llm if ENABLE_LLM else None,
            extract_fallback=_extract_fallback if ENABLE_DOCINTEL else None,
            circuit_breaker=AI_BREAKER,
            intent_llm=_intent_llm if ENABLE_LLM else None,
        )
        _preserve_workflow(case, previous_case)
        return case, reviews, breaker_before

    with ThreadPoolExecutor(max_workers=INGEST_WORKERS) as pool:
        results = list(pool.map(run_one, emails))

    for case, reviews, breaker_before in results:
        first_run = not STORE.list_events(case.email_id)
        STORE.put_case(case)
        STORE.replace_reviews(case.email_id, reviews)
        logger.info(
            "email processed",
            extra={
                "email_id": case.email_id,
                "correlation_id": case.correlation_id,
                "stage": "decision",
                "result": case.status,
            },
        )
        if first_run:
            _record_initial_events(case, reviews)
        else:
            _add_event(case, "COMPARISON_RERUN", "The case was processed again.")
        _record_breaker_transition(case, breaker_before)

    return {
        "processed": len(emails),
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }


@app.get("/api/cases")
def list_cases(
    category: str | None = None,
    status: str | None = None,
    lifecycle: str | None = None,
    limit: int = Query(50, le=500),
    offset: int = 0,
) -> dict:
    ensure_loaded()
    items, total = STORE.list_cases(
        category=category, status=status, lifecycle=lifecycle, limit=limit, offset=offset
    )
    return {
        "total": total,
        "items": [
            {
                "email_id": c.email_id,
                "correlation_id": c.correlation_id,
                "subject": c.subject,
                "from_addr": c.from_addr,
                "category": c.category,
                "status": c.status,
                "has_defect": c.has_defect,
                "defect_fields": c.defect_fields,
                "wire_review_reason": c.wire_review_reason,
                "summary": c.summary,
                "lifecycle": c.lifecycle,
                "assigned_to": c.assigned_to,
                "review_status": c.review_status,
                "received_at": c.received_at,
                "created_at": c.created_at,
                "updated_at": c.updated_at,
                "category_confidence": c.category_confidence,
            }
            for c in items
        ],
        "next_offset": offset + len(items) if offset + len(items) < total else None,
    }


@app.get("/api/cases/export.xlsx")
def export_all_cases_excel(
    period: Literal["all", "month", "year", "last_30_days"] = Query("all"),
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
) -> Response:
    """Download a dated case register and its related operational records."""
    ensure_loaded()
    cases, _ = STORE.list_cases(limit=max(len(STORE.cases), 1), offset=0)
    now = datetime.now(timezone.utc)
    cases, scope_label, date_range_label, filename_suffix = _export_period(
        cases, period, now, year=year, month=month
    )
    cache_key = (STORE.revision, period, year, month, now.date().isoformat())
    cache_state = "MISS"
    with _EXPORT_CACHE_LOCK:
        cached = _EXPORT_CACHE.get(cache_key)
        if cached and time.monotonic() - cached[0] < _EXPORT_CACHE_TTL_SECONDS:
            content = cached[1]
            cache_state = "HIT"
        else:
            case_ids = {case.email_id for case in cases}
            content = build_all_cases_workbook(
                cases,
                {case.email_id: STORE.list_events(case.email_id) for case in cases},
                [
                    review
                    for review in STORE.list_reviews(state=None, limit=10000)
                    if review.email_id in case_ids
                ],
                {
                    case.email_id: decision
                    for case in cases
                    if (decision := STORE.get_decision(case.email_id)) is not None
                },
                generated_at=now,
                scope_label=scope_label,
                date_range_label=date_range_label,
            )
            _EXPORT_CACHE[cache_key] = (time.monotonic(), content)
            while len(_EXPORT_CACHE) > _EXPORT_CACHE_MAX_ITEMS:
                _EXPORT_CACHE.pop(next(iter(_EXPORT_CACHE)))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="protozero-cases-{filename_suffix}.xlsx"',
            "X-ProtoZero-Export-Cache": cache_state,
        },
    )


def _export_period(
    cases: list[Case],
    period: Literal["all", "month", "year", "last_30_days"],
    now: datetime,
    *,
    year: int | None = None,
    month: int | None = None,
) -> tuple[list[Case], str, str, str]:
    """Apply a UTC reporting window and return labels used by the workbook."""
    if period == "all":
        return cases, "All cases", "All available dates", "all"

    if period == "month":
        selected_year = year or now.year
        selected_month = month or now.month
        start = datetime(selected_year, selected_month, 1, tzinfo=timezone.utc)
        if selected_month == 12:
            window_end = datetime(selected_year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            window_end = datetime(selected_year, selected_month + 1, 1, tzinfo=timezone.utc)
        display_end = min(now, window_end - timedelta(days=1))
        label = f"{start:%B %Y}"
        date_range = f"{start:%Y-%m-%d} to {display_end:%Y-%m-%d} (UTC)"
        suffix = f"{selected_year:04d}-{selected_month:02d}"
    elif period == "year":
        selected_year = year or now.year
        start = datetime(selected_year, 1, 1, tzinfo=timezone.utc)
        window_end = datetime(selected_year + 1, 1, 1, tzinfo=timezone.utc)
        display_end = min(now, window_end - timedelta(days=1))
        label = f"Year {selected_year}"
        date_range = f"{start:%Y-%m-%d} to {display_end:%Y-%m-%d} (UTC)"
        suffix = f"{selected_year:04d}"
    else:
        start = now - timedelta(days=30)
        window_end = None
        label = "Last 30 days"
        date_range = f"{start:%Y-%m-%d} to {now:%Y-%m-%d} (UTC)"
        suffix = "last-30-days"

    def in_window(case: Case) -> bool:
        timestamp = case.received_at or case.created_at
        if timestamp is None:
            return False
        received = timestamp
        if received.tzinfo is None:
            received = received.replace(tzinfo=timezone.utc)
        else:
            received = received.astimezone(timezone.utc)
        within_selected_period = window_end is None or received < window_end
        return start <= received <= now and within_selected_period

    return [case for case in cases if in_window(case)], label, date_range, suffix


@app.get("/api/cases/{email_id}")
def get_case(email_id: str) -> dict:
    case = STORE.get_case(email_id)
    if case is None:
        raise HTTPException(404, {"code": "not_found", "message": email_id})
    return case.model_dump(mode="json")


@app.get("/api/cases/{email_id}/document/{role}")
def get_document(email_id: str, role: Literal["SI", "BL"]) -> dict:
    ensure_loaded()
    case = _case_or_404(email_id)
    source = next((document for document in case.documents if document.role == role), None)
    if source is None:
        raise HTTPException(404, {"code": "not_found", "message": f"{email_id} has no {role}"})
    try:
        parsed = read_document(source.attachment_path, _inbox.read_bytes(source.attachment_path))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            422, {"code": "document_unreadable", "message": str(exc)}
        ) from exc
    return {
        "fmt": parsed.fmt,
        "text": parsed.full_text,
        "page_count": parsed.page_count,
        "attachment_path": source.attachment_path,
        "page_urls": [],
    }


@app.get("/api/cases/{email_id}/document/{role}/raw")
def get_raw_document(email_id: str, role: Literal["SI", "BL"]) -> Response:
    """Return the stored source attachment without altering it."""
    ensure_loaded()
    case = _case_or_404(email_id)
    source = next((document for document in case.documents if document.role == role), None)
    if source is None:
        raise HTTPException(404, {"code": "not_found", "message": f"{email_id} has no {role}"})
    try:
        content = _inbox.read_bytes(source.attachment_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(404, {"code": "not_found", "message": str(exc)}) from exc
    media_type = {
        "txt": "text/plain",
        "pdf": "application/pdf",
        "scan_pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }.get(source.fmt, "application/octet-stream")
    filename = Path(source.attachment_path).name.replace('"', "")
    # only txt and pdf render in a browser tab; inline on xlsx/docx gives a blank tab
    disposition = "inline" if source.fmt in ("txt", "pdf", "scan_pdf") else "attachment"
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
    )


@app.get("/api/cases/{email_id}/events")
def case_events(email_id: str) -> dict:
    ensure_loaded()
    _case_or_404(email_id)
    return {"items": [event.model_dump(mode="json") for event in STORE.list_events(email_id)]}


@app.get("/api/cases/{email_id}/report.pdf")
def case_report_pdf(email_id: str) -> Response:
    """Download the current case summary, comparisons, and audit trail."""
    ensure_loaded()
    case = _case_or_404(email_id)
    content = build_case_report_pdf(
        case,
        STORE.list_events(email_id),
        STORE.get_decision(email_id),
    )
    safe_id = "".join(character for character in email_id if character.isalnum() or character in "-_")
    safe_id = safe_id or "case"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_id}-case-report.pdf"'},
    )


@app.get("/api/cases/{email_id}/decision")
def get_case_decision(email_id: str) -> dict:
    ensure_loaded()
    _case_or_404(email_id)
    decision = STORE.get_decision(email_id)
    return {"decision": decision.model_dump(mode="json") if decision else None}


@app.patch("/api/cases/{email_id}/workflow")
def update_case_workflow(email_id: str, req: CaseWorkflowRequest) -> dict:
    """Assign a case and move it through the human review workflow."""
    ensure_loaded()
    case = _case_or_404(email_id)
    assigned_to = (req.assigned_to or "").strip() or None
    if req.review_status in {"assigned", "in_progress"} and not assigned_to:
        raise HTTPException(
            422,
            {"code": "assignee_required", "message": "Assigned and in-progress cases need an owner."},
        )

    previous_assignee = case.assigned_to
    previous_status = case.review_status
    case.assigned_to = assigned_to
    case.review_status = req.review_status
    case.lifecycle = "resolved" if req.review_status == "completed" else (
        "in_review" if req.review_status in {"assigned", "in_progress"} else "new"
    )
    case.updated_at = datetime.now(timezone.utc)
    STORE.put_case(case)

    if previous_assignee != assigned_to:
        _add_event(
            case,
            "CASE_ASSIGNED",
            "The case owner changed.",
            actor="reviewer",
            reviewer_id=req.reviewer_id,
            previous_value=previous_assignee or "Unassigned",
            new_value=assigned_to or "Unassigned",
        )
    if previous_status != req.review_status:
        _add_event(
            case,
            "REVIEW_STATUS_CHANGED",
            "The human review status changed.",
            actor="reviewer",
            reviewer_id=req.reviewer_id,
            previous_value=previous_status,
            new_value=req.review_status,
        )
    return {"case": case.model_dump(mode="json")}


@app.post("/api/cases/{email_id}/decision")
def set_case_decision(email_id: str, req: CaseDecisionRequest) -> dict:
    ensure_loaded()
    case = _case_or_404(email_id)
    now = datetime.now(timezone.utc)
    decision = CaseDecision(email_id=email_id, recorded_at=now, **req.model_dump())
    STORE.put_decision(decision)
    case.lifecycle = "in_review" if req.action in {"review", "request"} else "resolved"
    if req.action in {"approve", "reject"}:
        case.review_status = "completed"
    elif case.assigned_to and case.review_status == "unassigned":
        case.review_status = "assigned"
    case.updated_at = now
    STORE.put_case(case)
    manual_review_id = f"{email_id}:manual"
    if req.action in {"review", "request"}:
        field = case.defect_fields[0] if case.defect_fields else None
        comparison = next(
            (value for value in case.comparisons if value.field == field), None
        )
        STORE.put_review(
            ReviewItem(
                id=manual_review_id,
                email_id=email_id,
                fields=[field] if field else [],
                reason="MANUAL_REVIEW_REQUESTED",
                reason_detail=(
                    "A reviewer requested a second check of this case."
                    if req.action == "review"
                    else "A reviewer requested follow-up for a complete shipping instruction."
                ),
                si_value=comparison.si.value if comparison else None,
                bl_value=comparison.bl.value if comparison else None,
                si_evidence=comparison.si.evidence if comparison else None,
                bl_evidence=comparison.bl.evidence if comparison else None,
                confidence=comparison.confidence.score if comparison else None,
                created_at=now,
            )
        )
    else:
        STORE.delete_review(manual_review_id)
    _add_event(
        case,
        "FINAL_DECISION",
        req.done,
        actor="reviewer",
        reviewer_id=req.reviewer_id,
        new_value=req.action,
    )
    return {"decision": decision.model_dump(mode="json"), "case": case.model_dump(mode="json")}


@app.delete("/api/cases/{email_id}/decision")
def delete_case_decision(email_id: str, reviewer_id: str = "review-desk") -> dict:
    ensure_loaded()
    case = _case_or_404(email_id)
    previous = STORE.get_decision(email_id)
    STORE.delete_decision(email_id)
    STORE.delete_review(f"{email_id}:manual")
    case.lifecycle = "in_review" if case.status == "NEEDS_REVIEW" else "new"
    case.review_status = "assigned" if case.assigned_to else "unassigned"
    case.updated_at = datetime.now(timezone.utc)
    STORE.put_case(case)
    if previous:
        _add_event(
            case,
            "FINAL_DECISION",
            "The reviewer undid the case decision.",
            actor="reviewer",
            reviewer_id=reviewer_id,
            previous_value=previous.action,
        )
    return {"ok": True, "case": case.model_dump(mode="json")}


@app.post("/api/cases/{email_id}/rerun")
def rerun(email_id: str) -> dict:
    try:
        email = next(e for e in _inbox.emails() if e["email_id"] == email_id)
    except StopIteration:
        raise HTTPException(404, {"code": "not_found", "message": email_id}) from None
    breaker_before = AI_BREAKER.state
    previous_case = STORE.get_case(email_id)
    case, reviews = process_email(
        email,
        _inbox.read_bytes,
        classify_llm=_classify_llm if ENABLE_LLM else None,
        extract_fallback=_extract_fallback if ENABLE_DOCINTEL else None,
        circuit_breaker=AI_BREAKER,
        intent_llm=_intent_llm if ENABLE_LLM else None,
    )
    _preserve_workflow(case, previous_case)
    STORE.put_case(case)
    STORE.replace_reviews(email_id, reviews)
    _add_event(case, "COMPARISON_RERUN", "The pipeline reran this case.")
    _record_result_events(case, reviews)
    _record_breaker_transition(case, breaker_before)
    return case.model_dump(mode="json")


@app.get("/api/review")
def review_queue(state: str = "open", limit: int = Query(50, le=500)) -> dict:
    ensure_loaded()
    items = STORE.list_reviews(state=state, limit=limit)
    return {
        "items": [
            {
                **r.model_dump(mode="json"),
                "assigned_to": STORE.get_case(r.email_id).assigned_to if STORE.get_case(r.email_id) else None,
                "review_status": STORE.get_case(r.email_id).review_status if STORE.get_case(r.email_id) else "unassigned",
            }
            for r in items
        ],
        "open_count": STORE.open_count(),
    }


@app.post("/api/review/{review_id}/resolve")
def resolve_review(review_id: str, req: ResolveReviewRequest) -> dict:
    ensure_loaded()
    item = STORE.get_review(review_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": review_id})
    if item.state == "resolved":
        raise HTTPException(409, {"code": "already_resolved", "message": review_id})

    case = _case_or_404(item.email_id)
    field = req.field or (item.fields[0] if item.fields else None)
    comparison = next((value for value in case.comparisons if value.field == field), None)
    previous_value = (
        (comparison.si.value if req.document_role == "SI" else comparison.bl.value)
        if comparison
        else (item.si_value if req.document_role == "SI" else item.bl_value)
    )
    if req.action == "correct" and field and not req.correct_value:
        raise HTTPException(
            422, {"code": "correct_value_required", "message": "A corrected field needs a value."}
        )
    if req.action == "confirm" and comparison is not None and comparison.verdict == "ABSENT":
        raise HTTPException(
            422,
            {
                "code": "value_required",
                "message": "This field is blank in the document, so it can't be confirmed. "
                "Enter the correct value instead.",
            },
        )

    now = datetime.now(timezone.utc)
    item.state = "resolved"
    item.resolved_at = now
    item.resolved_by = req.reviewer_id
    STORE.put_review(item)

    if comparison:
        if req.action == "correct":
            corrected = recompare_with_correction(
                comparison,
                document_role=req.document_role,
                correct_value=req.correct_value or "",
            )
            case.comparisons = [
                corrected if value.field == field else value
                for value in case.comparisons
            ]
            comparison = corrected
        else:
            comparison.human_reviewed = True

        status, defects, reasons = decide(case.comparisons, [])
        case.status = status  # type: ignore[assignment]
        case.defect_fields = defects  # type: ignore[assignment]
        case.has_defect = status == "MISMATCH"
        case.escalation_reasons = reasons
        case.wire_review_reason = (
            to_wire_reason(reasons) if status == "NEEDS_REVIEW" else None
        )
        case.summary = comparison_summary(case)
    if field:
        correction = Correction(
            id=f"{review_id}:{STORE.next_event_seq(item.email_id)}",
            email_id=item.email_id,
            field=field,
            document_role=req.document_role,
            was_value=previous_value,
            correct_value=req.correct_value if req.action == "correct" else previous_value,
            label_seen=(
                comparison.si.label_seen if req.document_role == "SI" else comparison.bl.label_seen
            ) if comparison else None,
            action=req.action,
            reviewer_id=req.reviewer_id,
            created_at=now,
        )
        STORE.put_correction(correction)

    remaining = [
        review for review in STORE.list_reviews(state="open", limit=500)
        if review.email_id == item.email_id
    ]
    case.lifecycle = "in_review" if remaining else "resolved"
    case.review_status = "in_progress" if remaining and case.assigned_to else (
        "assigned" if remaining else "completed"
    )
    case.updated_at = now
    STORE.put_case(case)
    _add_event(
        case,
        "HUMAN_CORRECTION",
        "A reviewer confirmed the result." if req.action == "confirm" else "A reviewer supplied a correction.",
        actor="reviewer",
        reviewer_id=req.reviewer_id,
        field=field,
        previous_value=previous_value,
        new_value=req.correct_value if req.action == "correct" else previous_value,
    )
    if req.action == "correct" and comparison:
        _add_event(
            case,
            "COMPARISON_RERUN",
            "The human correction rejoined at comparison; source extraction was retained.",
            actor="reviewer",
            reviewer_id=req.reviewer_id,
            field=field,
            previous_value=previous_value,
            new_value=req.correct_value,
        )
    if not remaining:
        _add_event(
            case,
            "FINAL_DECISION",
            "All review items for this case are resolved.",
            actor="reviewer",
            reviewer_id=req.reviewer_id,
        )
    return {"review_item": item.model_dump(mode="json"), "case": case.model_dump(mode="json")}


@app.post("/api/review/{review_id}/retry")
def retry_review(review_id: str, req: RetryReviewRequest) -> dict:
    ensure_loaded()
    item = STORE.get_review(review_id)
    if item is None:
        raise HTTPException(404, {"code": "not_found", "message": review_id})
    email = _email_or_404(item.email_id)
    if req.force_llm:
        AI_BREAKER.begin_probe()
    breaker_before = AI_BREAKER.state
    previous_case = STORE.get_case(item.email_id)
    case, reviews = process_email(
        email,
        _inbox.read_bytes,
        classify_llm=_classify_llm if ENABLE_LLM else None,
        extract_fallback=_extract_fallback if ENABLE_DOCINTEL else None,
        circuit_breaker=AI_BREAKER,
        intent_llm=_intent_llm if ENABLE_LLM else None,
    )
    _preserve_workflow(case, previous_case)
    STORE.put_case(case)
    STORE.replace_reviews(item.email_id, reviews)
    _add_event(
        case,
        "COMPARISON_RERUN",
        "A reviewer retried the failed stage" + (" with AI fallback requested." if req.force_llm else "."),
        actor="reviewer",
        reviewer_id=item.resolved_by or "review-desk",
    )
    _record_result_events(case, reviews)
    _record_breaker_transition(case, breaker_before)
    current = STORE.get_review(review_id) or item
    return {"review_item": current.model_dump(mode="json"), "case": case.model_dump(mode="json")}


@app.get("/api/metrics")
def metrics() -> dict:
    ensure_loaded()
    return STORE.metrics()


@app.get("/api/submission")
def submission() -> dict:
    ensure_loaded()
    return {eid: to_submission_entry(c) for eid, c in sorted(STORE.cases.items())}


def _case_or_404(email_id: str) -> Case:
    case = STORE.get_case(email_id)
    if case is None:
        raise HTTPException(404, {"code": "not_found", "message": email_id})
    return case


def _preserve_workflow(case: Case, previous: Case | None) -> None:
    """Pipeline reruns replace technical results, never human ownership."""
    if previous is None:
        return
    case.assigned_to = previous.assigned_to
    case.review_status = previous.review_status
    case.lifecycle = previous.lifecycle


def _email_or_404(email_id: str) -> dict:
    try:
        return next(email for email in _inbox.emails() if email["email_id"] == email_id)
    except StopIteration:
        raise HTTPException(404, {"code": "not_found", "message": email_id}) from None


def _add_event(
    case: Case,
    action: str,
    reason: str,
    *,
    actor: str = "system",
    reviewer_id: str | None = None,
    field: str | None = None,
    previous_value: str | None = None,
    new_value: str | None = None,
) -> None:
    seq = STORE.next_event_seq(case.email_id)
    event = AuditEvent(
        id=f"{case.email_id}:{seq}",
        email_id=case.email_id,
        correlation_id=case.correlation_id,
        seq=seq,
        at=datetime.now(timezone.utc),
        actor=actor,
        reviewer_id=reviewer_id,
        action=action,
        field=field,
        previous_value=previous_value,
        new_value=new_value,
        reason=reason,
    )
    STORE.add_event(event)


def _record_initial_events(case: Case, reviews: list) -> None:
    _add_event(case, "EMAIL_RECEIVED", "The email entered the verification pipeline.")
    _add_event(
        case,
        "DOCUMENT_CLASSIFIED",
        f"The email was classified as {case.category.lower().replace('_', ' ')}.",
    )
    _record_result_events(case, reviews)


def _record_result_events(case: Case, reviews: list) -> None:
    if case.documents:
        used_ai = any(
            document.fields
            and any(
                document.fields.get(field).extracted_by in {"doc_intelligence", "llm"}
                for field in FIELD_NAMES
            )
            for document in case.documents
        )
        _add_event(
            case,
            "AI_EXTRACTION_COMPLETED" if used_ai else "EXTRACTION_COMPLETED",
            f"The pipeline read {len(case.documents)} attached document(s).",
        )
    if case.escalation_reasons:
        _add_event(
            case,
            "VALIDATION_FAILED",
            "; ".join(reason.lower().replace("_", " ") for reason in case.escalation_reasons),
        )
    if reviews:
        _add_event(
            case,
            "HUMAN_REVIEW_CREATED",
            f"{len(reviews)} review item(s) were opened.",
        )
    _add_event(case, "FINAL_DECISION", case.summary)


def _record_breaker_transition(case: Case, previous_state: str) -> None:
    if previous_state != "open" and AI_BREAKER.state == "open":
        _add_event(
            case,
            "CIRCUIT_BREAKER_OPENED",
            "Repeated optional AI service failures activated deterministic-only mode.",
        )
    elif previous_state in {"open", "half_open"} and AI_BREAKER.state == "closed":
        _add_event(
            case,
            "CIRCUIT_BREAKER_CLOSED",
            "The optional AI service recovered and full mode resumed.",
        )


# Keep this mount last so every explicit API and documentation route wins.
# The Docker image always contains web/dist; local API-only development still
# works when the frontend has not been built yet.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_DIST = PROJECT_ROOT / "web" / "dist"
if WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
