# SessionBridge — Summary Generation Design (MVP v1)

This document defines the complete, production-ready design for the 15-day summary generation pipeline.

It incorporates:

* Functional report requirements (structure + neutrality rules)
* LLM-heavy generation with minimal deterministic Python logic
* Separate writing paths for Sections 2–3 and Section 4
* Coverage-first guarantee for Section 4
* Single GuardFix pass
* Full JSON contracts for every stage
* Prompt templates included
* Logging, traceability, and audit requirements

This document is intended to be sufficient for engineering implementation in one pass.

---

# 0. Core Design Principles

1. Deterministic structure, LLM-controlled language.
2. Python performs only structural logic (counts, thresholds, assembly).
3. No spaCy, no regex NLP parsing, no semantic inference in Python.
4. LLM stages are JSON-in / JSON-out.
5. Section 4 is coverage-first (never drop distinct factual points).
6. Only one GuardFix pass.
7. All intermediate artifacts stored for audit.

---

# 1. Functional Structure (Locked)

Report sections in this order:

1. Section 1 — Time Window & Scope (Python only)
2. Section 2 — Observed Patterns & Limits (LLM Writer A)
3. Section 3 — Open Points for Reflection (optional, LLM Writer A)
4. Section 4 — Logged Moments (LLM Writer B, coverage-first)

Adaptive rules:

* 1–2 days with entries → Section 3 disabled
* 3–5 days → Section 3 allowed only if defensible
* 6+ days → Section 3 allowed (max 3 statements)

---

# 2. Pipeline Overview

Stages:

P0  → Python: Window selection + day bucketing + eligibility flags
L1  → LLM: Canonicalizer
L2A → LLM: Writer A (Section 2 + 3)
L2B → LLM: Writer B (Section 4)
L3  → LLM: GuardFix (single pass)
P1  → Python: Final assembly + rendering

---

# 3. Stage Details

============================================================
P0 — Python: Window Selection + Bucketing
=========================================

Input:

* Raw message records from DB

Rules:

* Select last 15 calendar days (user timezone aware)
* No trimming or cleaning of message text
* Group by calendar day
* Compute counts

Output: window_bundle.json

Schema:

{
"user_id": "uuid",
"timezone": "Asia/Kolkata",
"window": {
"start_date": "YYYY-MM-DD",
"end_date": "YYYY-MM-DD",
"days": 15
},
"counts": {
"total_messages": 42,
"days_with_entries": 9
},
"signal_bucket": "LOW|MEDIUM|HIGH",
"section3_allowed_by_counts": true,
"days": [
{
"date": "YYYY-MM-DD",
"messages": [
{
"message_id": "id",
"created_at": "ISO timestamp",
"text": "raw text"
}
]
}
]
}

Signal bucket logic:

* days_with_entries <= 2 → LOW
* 3–5 → MEDIUM
* > =6 → HIGH

Section 3 eligibility (by counts only):

* LOW → false
* MEDIUM → true
* HIGH → true

No language analysis performed in Python.

---

============================================================
L1 — Canonicalizer (LLM)
========================

Purpose:
Convert raw logs into structured, factual, traceable JSON.

Input:

* window_bundle.json

Output: canonical.json

Schema:

{
"window": { "start_date": "", "end_date": "" },
"counts": { "days_with_entries": 0, "total_messages": 0 },
"per_day": [
{
"date": "YYYY-MM-DD",
"topic_sentence_seed": "Neutral descriptive topic sentence.",
"facts": [
{
"fact": "Factual statement.",
"source_snippet": "5–12 word snippet from source"
}
],
"explicit_emotions": ["only if explicitly stated"],
"numeric_logs": []
}
],
"repeat_candidates": [
{
"label": "short label",
"count": 3,
"evidence_snippets": ["snippet1", "snippet2"]
}
],
"limits_signals": {
"data_density": "sparse|moderate|dense",
"reflection_defensible": true
}
}

Rules:

* JSON only
* No interpretation
* No causality
* No advice
* No invention
* Every fact must include source_snippet
* Topic sentence must be strictly descriptive
* Repeat candidates only if actual repetition exists

---

============================================================
L2A — Writer A (Section 2 + Section 3)
======================================

Input:

* canonical.json
* section3_allowed_by_counts

Output: draft_s2_s3.json

Schema:

{
"section2_text": "",
"section3_text": "",
"section3_included": true
}

Rules:

Section 2:

* Bullet points describing repeated elements
* Must include explicit "Limits:" line
* No causality
* No advice
* No interpretation

Section 3:

* Only if section3_allowed_by_counts AND reflection_defensible
* 1–3 statements
* Statements only (not questions)
* Neutral tone

---

============================================================
L2B — Writer B (Section 4, Coverage-First)
==========================================

Input:

* canonical.json

Output: draft_s4.json

Schema:

{
"section4_text": ""
}

Rules:

* One entry per calendar day (max 15)
* Use topic_sentence_seed as anchor
* Multi-paragraph allowed per day
* Preserve ALL distinct factual points
* Emotions only if explicit
* Numeric values preserved exactly
* No inference

Coverage-first rule:
Never drop distinct facts to shorten text.

---

============================================================
L3 — GuardFix (Single Pass)
===========================

Input:

* canonical.json
* draft_s2_s3.json
* draft_s4.json

Output: final_sections.json

Schema:

{
"status": "PASS|FIXED",
"changes": ["list of modifications"],
"section2_text": "",
"section3_text": "",
"section3_included": true,
"section4_text": ""
}

Responsibilities:

* Remove advice
* Remove causality
* Remove interpretive phrasing
* Ensure Section 3 statements not questions
* Remove Section 3 if not defensible
* Ensure no invented facts
* Preserve Section 4 coverage

Only one pass allowed.

---

============================================================
P1 — Final Assembly (Python)
============================

Section 1 template (Python only):

Must include:

* Time window
* Days with entries
* Neutral limits statement

Final order:

1. Section 1
2. Section 2
3. Section 3 (if included)
4. Section 4

---

# 4. Prompt Templates (v1)

All prompts must be versioned and stored in:

* prompts/canonicalizer_v1.md
* prompts/writer_s2_s3_v1.md
* prompts/writer_s4_v1.md
* prompts/guardfix_v1.md

Each stage must log prompt_version.

---

## Canonicalizer Prompt (v1)

You are a neutral canonicalizer.
Output JSON only.

Rules:

* Extract factual statements per day.
* Include source_snippet for every fact.
* No interpretation.
* No advice.
* No causality.
* No invention.
* Generate repeat_candidates only if repetition exists.
* Generate topic_sentence_seed per day (descriptive only).

Return strictly valid JSON.

---

## Writer A Prompt (v1)

You are generating Section 2 and Section 3 of a reflection report.
Use only canonical.json.

Rules:

* Section 2: bullet points + mandatory "Limits:" line.
* Section 3: only if allowed; statements only; max 3.
* No advice.
* No interpretation.
* No causality.
* No invented facts.

Return JSON only.

---

## Writer B Prompt (v1)

You are generating Section 4 (Logged Moments).
Coverage-first.

Rules:

* Preserve all distinct facts.
* One entry per day.
* Multi-paragraph allowed.
* Use topic_sentence_seed.
* No inference.
* No advice.
* No invention.

Return JSON only.

---

## GuardFix Prompt (v1)

You are a strict compliance validator and fixer.

Rules:

* Remove advice.
* Remove causality.
* Remove interpretation.
* Ensure Section 3 statements only.
* Remove Section 3 if not defensible.
* Do not add new facts.
* Preserve Section 4 coverage.

Return corrected JSON.

---

# 5. Logging & Observability

For every report generation store:

* report_id
* user_id
* window start/end
* input_hash (hash of message IDs + text)
* window_bundle.json
* canonical.json
* draft_s2_s3.json
* draft_s4.json
* final_sections.json
* prompt_versions
* model identifiers
* token usage (if available)
* latency per stage
* guardfix status

Logs must allow:

* Replaying generation
* Auditing hallucination risk
* Comparing prompt versions

---

# 6. Fallback Behavior

If GuardFix output invalid JSON:

* Abort and log error
* Return minimal safe report:

  * Section 1
  * Section 2 with Limits only
  * Section 4 basic reconstruction

---

# 7. Versioning Strategy

All prompts versioned.
All schema changes versioned.
Persist prompt_version per stage.

---

END OF SPEC
