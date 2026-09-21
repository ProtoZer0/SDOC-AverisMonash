"""Every threshold, deployment name and path in one place. One-line swaps.

Nothing here is read from the environment at import time except secrets, so the
deterministic path runs with no Azure configuration at all.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_REFS = REPO_ROOT / "data_refs"
CACHE_DIR = REPO_ROOT / ".cache" / "azure"

PIPELINE_VERSION = os.getenv("GIT_SHA", "dev")
PROMPT_VERSION = "v1"

# --- dataset -------------------------------------------------------------
DEFAULT_SOURCE = os.getenv("SDOC_SOURCE", str(REPO_ROOT / "sdoc-hackathon-bundle"))

# --- comparison ----------------------------------------------------------
# rapidfuzz ratio band that routes a near-miss to a human. It can NEVER
# produce MATCH — see docs/spec/pipeline.md stage 5.
BORDERLINE_LOW = 85.0
BORDERLINE_HIGH = 100.0

# --- confidence ----------------------------------------------------------
REVIEW_THRESHOLD = 0.55

# Consecutive optional cloud failures before all further model/document calls
# are skipped. The deterministic path continues to process the inbox.
AI_FAILURE_THRESHOLD = int(os.getenv("SDOC_AI_FAILURE_THRESHOLD", "3"))

CONFIDENCE_WEIGHTS = {
    "cross_check": 0.35,
    "doc_quality": 0.30,
    "label_directness": 0.25,
    "service_confidence": 0.20,
    "model_selfrating": 0.05,
}

DOC_QUALITY = {
    "txt": 1.0,
    "pdf": 0.9,
    "docx": 0.9,
    "xlsx": 0.9,
    "scan_pdf": 0.5,
}

# --- classification ------------------------------------------------------
# Confidence reported for a rule hit. Rules on this corpus are exact-match on
# subject grammar, so this is high by construction, not by optimism.
RULE_CONFIDENCE = 0.95
LLM_FALLBACK_CONFIDENCE_FLOOR = 0.40

# --- Azure ---------------------------------------------------------------
# Azure OpenAI is called by DEPLOYMENT NAME, not model id. The underlying model
# is a portal decision; this is the only place the name appears in code.
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
AZURE_OPENAI_DEPLOYMENT_CLASSIFY = os.getenv("AZURE_OPENAI_DEPLOYMENT_CLASSIFY", "")
AZURE_OPENAI_DEPLOYMENT_EXTRACT = os.getenv("AZURE_OPENAI_DEPLOYMENT_EXTRACT", "")

AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")

AZURE_DOCINTEL_ENDPOINT = os.getenv("AZURE_DOCINTEL_ENDPOINT", "")
AZURE_DOCINTEL_KEY = os.getenv("AZURE_DOCINTEL_KEY", "")
AZURE_DOCINTEL_MODEL = os.getenv("AZURE_DOCINTEL_MODEL", "prebuilt-layout")

TEMPERATURE = 0.0
AI_TIMEOUT_S = float(os.getenv("SDOC_AI_TIMEOUT_S", "20"))
INGEST_WORKERS = int(os.getenv("SDOC_INGEST_WORKERS", "4"))

# Master switch. `--no-llm` on the eval runner flips this; the deterministic
# path must be provably complete without any cloud call.
ENABLE_LLM = os.getenv("SDOC_ENABLE_LLM", "1") not in ("0", "false", "False")
ENABLE_DOCINTEL = os.getenv("SDOC_ENABLE_DOCINTEL", "1") not in ("0", "false", "False")


def azure_openai_configured() -> bool:
    return bool(
        AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT_CLASSIFY
    )


def docintel_configured() -> bool:
    return bool(AZURE_DOCINTEL_ENDPOINT and AZURE_DOCINTEL_KEY)
