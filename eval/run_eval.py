"""Run the whole inbox and write a submission file.

    python -m eval.run_eval --source sdoc-hackathon-bundle --out submission.json
    python -m eval.run_eval --limit 20 --no-llm

The `--no-llm` path must produce a complete, schema-valid submission with zero
cloud calls. If it ever cannot, the deterministic core has a hole in it.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

from pipeline.config import DEFAULT_SOURCE
from pipeline.report import to_submission_entry
from pipeline.run import process_email


class Inbox:
    """Local-bundle reader with the same surface as the organisers' loader."""

    def __init__(self, source: str) -> None:
        self.root = Path(source)

    def emails(self) -> list[dict]:
        return [
            json.loads(p.read_text(encoding="utf-8"))
            for p in sorted((self.root / "inbox").glob("email_*.json"))
        ]

    def read_bytes(self, att_path: str) -> bytes:
        return (self.root / att_path).read_bytes()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=DEFAULT_SOURCE)
    ap.add_argument("--out", default="submission.json")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--cases-out", default="")
    args = ap.parse_args(argv)

    inbox = Inbox(args.source)
    emails = inbox.emails()
    if args.limit:
        emails = emails[: args.limit]

    classify_llm = None
    intent_llm = None
    extract_fallback = None
    if not args.no_llm:
        try:
            from pipeline.azure_llm import classify_with_llm, intent_with_llm

            classify_llm, intent_llm = classify_with_llm, intent_with_llm
        except Exception:  # noqa: BLE001 — absence of credentials is normal
            pass
        try:
            from pipeline.azure_docintel import extract_with_docintel

            extract_fallback = extract_with_docintel
        except Exception:  # noqa: BLE001
            pass
    services = [n for n, on in (("azure-openai", classify_llm), ("document-intelligence", extract_fallback)) if on]
    print("cloud:", ", ".join(services) if services else "none (deterministic only)")

    submission: dict[str, dict] = {}
    cases = []
    started = time.perf_counter()
    failures = 0

    for email in emails:
        try:
            case, _reviews = process_email(
                email,
                inbox.read_bytes,
                classify_llm=classify_llm,
                extract_fallback=extract_fallback,
                intent_llm=intent_llm,
            )
            submission[email["email_id"]] = to_submission_entry(case)
            cases.append(case)
        except Exception as exc:  # noqa: BLE001
            # A crash must never drop an email from the submission. A failed
            # email is a review item, not a missing key.
            failures += 1
            print(f"  ! {email['email_id']}: {type(exc).__name__}: {exc}", file=sys.stderr)
            submission[email["email_id"]] = {
                "category": "BL_COMPARISON",
                "status": "NEEDS_REVIEW",
                "review_reason": "unreadable",
                "defect_fields": [],
                "has_defect": False,
                "decided_by": "rule",
            }

    elapsed = time.perf_counter() - started
    Path(args.out).write_text(json.dumps(submission, indent=2), encoding="utf-8")
    if args.cases_out:
        Path(args.cases_out).write_text(
            json.dumps([c.model_dump(mode="json") for c in cases], indent=2),
            encoding="utf-8",
        )

    _print_summary(submission, cases, elapsed, failures, args.out)
    return 0


def _print_summary(submission, cases, elapsed, failures, out) -> None:
    cats = Counter(v["category"] for v in submission.values())
    stats = Counter(v["status"] for v in submission.values())
    reasons = Counter(
        v["review_reason"] for v in submission.values() if v["review_reason"]
    )
    rule = sum(1 for v in submission.values() if v.get("decided_by") == "rule")
    defects = [v for v in submission.values() if v["has_defect"]]
    fields = Counter(f for v in defects for f in v["defect_fields"])

    print(f"\n{len(submission)} emails in {elapsed:.1f}s  ->  {out}")
    if failures:
        print(f"  {failures} email(s) failed hard and were escalated")
    print("\ncategory      " + "  ".join(f"{k}={v}" for k, v in sorted(cats.items())))
    print("status        " + "  ".join(f"{k}={v}" for k, v in sorted(stats.items())))
    print("review reason " + ("  ".join(f"{k}={v}" for k, v in sorted(reasons.items())) or "none"))
    print(f"decided by    rule={rule}  llm={len(submission) - rule}")
    print(f"\n{len(defects)} emails flagged with a defect")
    for field, n in fields.most_common():
        print(f"  {field:<20} {n}")


if __name__ == "__main__":
    raise SystemExit(main())
