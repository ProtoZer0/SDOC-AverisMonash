from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest

from eval.run_eval import Inbox
from parsers.read import read as read_document
from pipeline.classify import classify
from pipeline.gate import gate
from pipeline.report import to_submission_entry
from pipeline.run import process_email

BUNDLE = Path(__file__).resolve().parents[1] / "sdoc-hackathon-bundle"
inbox = Inbox(str(BUNDLE))


def _email(email_id: str) -> dict:
    return json.loads((BUNDLE / "inbox" / f"{email_id}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("module", ["pipeline.azure_llm", "pipeline.azure_docintel"])
def test_unconfigured_adapter_refuses_to_import(module, monkeypatch):
    for var in (
        "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT_CLASSIFY",
        "AZURE_DOCINTEL_ENDPOINT", "AZURE_DOCINTEL_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
    import pipeline.config as cfg
    importlib.reload(cfg)
    with pytest.raises(ImportError):
        importlib.import_module(module)


def test_model_says_send_closes_the_case_as_awaiting_documents():
    result = gate([], "anything", {}, intent_fn=lambda body: ("SEND", 0.93, "asks for a draft"))
    assert result.awaiting_documents and result.intent_source == "llm"


def test_model_says_compare_escalates_missing_attachment():
    result = gate([], "anything", {}, intent_fn=lambda body: ("COMPARE", 0.91, "wants a check"))
    assert not result.awaiting_documents
    assert result.escalations == ["MISSING_ATTACHMENT"]


def test_unclear_or_unsure_intent_takes_the_cautious_path():
    for answer in (("UNCLEAR", 0.9, "?"), ("SEND", 0.4, "maybe")):
        result = gate([], "anything", {}, intent_fn=lambda body, a=answer: a)
        assert not result.awaiting_documents, answer


def test_model_failure_falls_back_to_the_phrase_rule():
    def broken(body):
        raise TimeoutError("network pulled")

    send = "Please assist to send the draft BL for 5ALT-01226 for checking asap."
    result = gate([], send, {}, intent_fn=broken)
    assert result.awaiting_documents and result.intent_source == "rule"


def test_unknown_domain_goes_to_the_model_not_the_spam_bin():
    seen = {}

    def fake(subject, body, domain, n):
        seen["domain"] = domain
        return "BL_COMPARISON", 0.88

    cat, by, _ = classify("TO CONFIRM DOCS _ X", "please check", "ops@newcustomer.com", 2, llm_fn=fake)
    assert (cat, by) == ("BL_COMPARISON", "llm") and seen["domain"] == "newcustomer.com"


def test_unknown_domain_without_a_model_is_still_spam():
    cat, by, _ = classify("hello", "hi", "x@newcustomer.com", 0)
    assert (cat, by) == ("SPAM", "rule")


def test_unknown_domain_when_the_model_fails_is_spam():
    def broken(*a):
        raise ConnectionError

    cat, by, _ = classify("hello", "hi", "x@newcustomer.com", 0, llm_fn=broken)
    assert (cat, by) == ("SPAM", "rule")


def test_known_spam_domain_never_costs_a_model_call():
    def must_not_run(*a):
        raise AssertionError("model called for a known spam domain")

    cat, by, _ = classify("You won", "click", "a@prize-claims.info", 0, llm_fn=must_not_run)
    assert (cat, by) == ("SPAM", "rule")


def _fake_ocr_from(source_email: str):
    def fallback(attachments, documents, read_bytes):
        out = {}
        for path in attachments:
            if not documents[path].needs_ocr:
                continue
            role = "SI" if path.upper().endswith("_SI.PDF") else "BL"
            twin = next(p for p in _email(source_email)["attachments"] if f"_{role}." in p)
            doc = read_document(twin, inbox.read_bytes(twin))
            doc.fmt = "scan_pdf"
            doc.ocr_confidence = 0.97
            for name in ("shipper", "consignee", "notify_party", "port_of_loading",
                         "port_of_discharge", "container_count", "gross_weight_kg"):
                f = doc.fields.get(name)
                f.extracted_by = "doc_intelligence"
                f.service_confidence = 0.97
            out[path] = doc
        return out or None

    return fallback


def test_scanned_case_is_read_but_held_for_a_person():
    email = _email("email_513")
    case, reviews = process_email(
        email, inbox.read_bytes, extract_fallback=_fake_ocr_from("email_499")
    )
    assert case.status == "NEEDS_REVIEW"
    assert case.wire_review_reason == "unreadable"
    assert case.comparisons, "the reviewer should see the OCR read side by side"
    assert case.models.get("ocr") == "azure-document-intelligence"
    assert any(d.fmt == "scan_pdf" and d.readable for d in case.documents)
    assert "scanned image" in case.summary
    assert reviews and reviews[0].reason == "UNREADABLE_DOCUMENT"
    entry = to_submission_entry(case)
    assert entry["status"] == "NEEDS_REVIEW" and entry["defect_fields"] == []


def test_scanned_case_with_differences_reports_them_as_candidates_only():
    email = _email("email_513")
    case, reviews = process_email(
        email, inbox.read_bytes, extract_fallback=_fake_ocr_from("email_499")
    )
    assert not case.has_defect and case.defect_fields == []
    if any(c.verdict == "MISMATCH" for c in case.comparisons):
        assert "possible difference" in case.summary


def test_scanned_case_never_claims_a_field_ocr_could_not_read():
    def fallback(attachments, documents, read_bytes):
        out = _fake_ocr_from("email_499")(attachments, documents, read_bytes)
        for doc in (out or {}).values():
            doc.fields.shipper.value = None
            doc.fields.shipper.evidence = None
        return out

    case, _ = process_email(
        _email("email_513"), inbox.read_bytes, extract_fallback=fallback
    )
    assert any(c.field == "shipper" and c.verdict == "ABSENT" for c in case.comparisons)
    assert "as matching" not in case.summary
    assert "could not read shipper" in case.summary


def test_two_scanned_documents_are_described_in_the_plural():
    case, _ = process_email(
        _email("email_513"), inbox.read_bytes, extract_fallback=_fake_ocr_from("email_499")
    )
    assert "are scanned images" in case.summary
    assert " is a scanned image" not in case.summary


def test_truncated_pdf_is_never_sent_to_ocr():
    called = []

    def spy(attachments, documents, read_bytes):
        called.extend(p for p in attachments if documents[p].needs_ocr)
        return None

    case, _ = process_email(_email("email_511"), inbox.read_bytes, extract_fallback=spy)
    assert case.wire_review_reason == "unreadable"
    assert called == [], "a corrupt file has no image for OCR to read"


def test_confirming_a_blank_field_is_refused():
    from fastapi.testclient import TestClient

    from api.main import app

    with TestClient(app) as client:
        client.post("/api/ingest", json={"email_ids": ["email_520"]})
        refused = client.post(
            "/api/review/email_520:consignee/resolve",
            json={"action": "confirm", "document_role": "SI", "reviewer_id": "test"},
        )
        assert refused.status_code == 422
        assert client.get("/api/cases/email_520").json()["status"] == "NEEDS_REVIEW"

        fixed = client.post(
            "/api/review/email_520:consignee/resolve",
            json={
                "action": "correct",
                "field": "consignee",
                "document_role": "SI",
                "correct_value": "CLIFFORD PAPER INC",
                "reviewer_id": "test",
            },
        )
        assert fixed.status_code == 200
        assert fixed.json()["case"]["status"] == "OK"

        client.post("/api/ingest", json={"email_ids": ["email_520"]})
        assert client.get("/api/cases/email_520").json()["status"] == "NEEDS_REVIEW"


def test_full_inbox_with_an_intent_model_keeps_every_scored_answer():
    def intent_like_the_rules(body):
        from pipeline.gate import wants_comparison_now

        return ("COMPARE" if wants_comparison_now(body) else "SEND"), 0.95, "fake"

    changed = []
    for email in inbox.emails():
        base, _ = process_email(email, inbox.read_bytes)
        ai, _ = process_email(email, inbox.read_bytes, intent_llm=intent_like_the_rules)
        a, b = to_submission_entry(base), to_submission_entry(ai)
        a.pop("decided_by"), b.pop("decided_by")
        if a != b:
            changed.append(email["email_id"])
    assert changed == []
