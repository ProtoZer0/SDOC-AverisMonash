from __future__ import annotations

import io
import statistics

from pipeline import config

if not config.docintel_configured():
    raise ImportError("Azure Document Intelligence is not configured")

from azure.ai.documentintelligence import DocumentIntelligenceClient  # noqa: E402
from azure.core.credentials import AzureKeyCredential  # noqa: E402

from parsers.common import sha256  # noqa: E402
from parsers.doctype import detect  # noqa: E402
from parsers.linescan import scan  # noqa: E402
from parsers.read import ParsedDocument  # noqa: E402
from pipeline.schemas import FIELD_NAMES, Locator  # noqa: E402

_client = DocumentIntelligenceClient(
    endpoint=config.AZURE_DOCINTEL_ENDPOINT,
    credential=AzureKeyCredential(config.AZURE_DOCINTEL_KEY),
)


def extract_with_docintel(
    attachments: list[str],
    documents: dict[str, ParsedDocument],
    read_bytes,
) -> dict[str, ParsedDocument] | None:
    recovered = {
        path: _ocr(read_bytes(path))
        for path in attachments
        if documents.get(path) is not None and documents[path].needs_ocr
    }
    return recovered or None


def _ocr(data: bytes) -> ParsedDocument:
    poller = _client.begin_analyze_document(
        config.AZURE_DOCINTEL_MODEL,
        io.BytesIO(data),
        content_type="application/octet-stream",
    )
    result = poller.result(timeout=config.AI_TIMEOUT_S * 3)

    text = result.content or ""
    pages = result.pages or []
    lines = [(page.page_number, line.polygon) for page in pages for line in page.lines or []]
    words = [w for page in pages for w in page.words or []]
    confidence = round(statistics.fmean(w.confidence for w in words), 4) if words else 0.0

    bag = scan(
        text,
        allow_block=True,
        allow_glued=True,
        page_of_line={i: page for i, (page, _) in enumerate(lines)},
    )
    fields = bag.to_fields(extracted_by="doc_intelligence")

    for name in FIELD_NAMES:
        field = fields.get(name)
        if not field.found:
            continue
        field.service_confidence = confidence
        line_no = field.locator.line if field.locator else None
        if line_no is not None and line_no < len(lines):
            page, polygon = lines[line_no]
            field.locator = Locator(
                page=page,
                line=line_no,
                char_start=field.locator.char_start,
                char_end=field.locator.char_end,
                bbox=_bbox(polygon),
            )

    return ParsedDocument(
        fmt="scan_pdf",
        readable=bool(text.strip()),
        fields=fields,
        bag=bag,
        full_text=text,
        text_sha256=sha256(text) if text else None,
        page_count=len(pages) or None,
        detected_kind=detect(text, fields_found=fields.found_count()),
        parse_error=None if text.strip() else "OCR returned no text",
        ocr_confidence=confidence,
    )


def _bbox(polygon) -> list[float] | None:
    if not polygon or len(polygon) < 4:
        return None
    xs, ys = polygon[0::2], polygon[1::2]
    return [round(v * 72, 2) for v in (min(xs), min(ys), max(xs), max(ys))]
