# SessionBridge (MVP) — 15-Day Activity Report

## Purpose of this document

Functional specification for the **15-day report** feature, written for review and feedback.

---

## 1) What the report is

A **15-day memory compression** of what the user chose to log.

* Default window: last **15 calendar days**.
* Primary use: user reflection.
* Secondary use: safe to share with a coach.
* Core goal: improve recall and continuity — not evaluate, diagnose, coach, or interpret.

One-line framing:

> This report summarizes what you logged in the last 15 days, in a neutral and structured format.

---

## 2) Design constraints (non-negotiable)

### 2.1 Coach-safe neutrality

* No judgmental language.
* No motivational tone.
* No advice or prescriptions.

### 2.2 Summarization, not meaning-making

Allowed:

* Structural compression.
* Repetition counting.
* Stating limits based on data volume.

Not allowed:

* Causal claims.
* Psychological interpretation.
* Predictive statements.

### 2.3 Never invent structure when signal is low

Low data → minimal structure.

### 2.4 No charts / no scores (MVP)

Text-only. No mood graphs, no scoring, no visual evaluation.

---

## 3) Final Section Order (Summary First)

The report follows a **summary-first, details-last** structure:

1. Time Window & Scope
2. Observed Patterns & Limits
3. Open Points for Reflection (optional)
4. Logged Moments (detailed reconstruction)

---

## 4) Section-by-section specification

### Section 1 — Time Window & Scope (always)

**Purpose:** anchor expectations.

Must include:

* Time window (e.g., last 15 days).
* Number of days with entries.
* A neutral limitation statement.

Must not include:

* Evaluation of consistency.
* Encouragement or motivation.

---

### Section 2 — Observed Patterns & Limits (always)

**Purpose:** high-level orientation without interpretation.

Format:

* Bullet points for repetition.
* Mandatory **Limits** line.

May include:

* Repeated contexts, actions, or explicitly mentioned emotions.

Must not include:

* Causality.
* Advice.
* Explanations.

---

### Section 3 — Open Points for Reflection (optional)

**Purpose:** neutral conversation starters.

Generated only when signal is sufficient.

Format:

* 1–3 short neutral statements.
* Statements, not questions.

Must not include:

* Advice.
* Interpretation.

---

### Section 4 — Logged Moments (always, appears last)

**Purpose:** detailed recall.

Rules:

* Daily consolidation (max 15 entries).
* One entry per calendar day.

Each entry contains:

* A **neutral system-written topic sentence** capturing what the day was broadly about.
* A short paragraph condensing that day’s logs.

Boundaries:

* Emotions appear only if explicitly logged.
* Numeric-only logs remain numeric.
* No inferred meaning.

---

## 5) Adaptive behavior

* 1–2 logged days → minimal structure; patterns may collapse into Limits only.
* 3–5 logged days → cautious pattern bullets.
* 6+ logged days → fuller but still non-causal patterns.
* Section 3 (reflection) appears only when defensible.

Principle:

> The report should never sound more confident than the data.

---

## 6) Minimal Visual Design Guidance

Allowed:

* Clear section headers.
* Generous spacing.
* Horizontal dividers.
* Textual count indicators.

Avoid:

* Emotion icons.
* Color-coded feedback.
* Scores or performance signals.

---

## 7) Safety Note

High-severity entries require separate escalation logic.
This spec does not define that flow.

---

## 8) Locked Decisions Recap

* 15-day rolling window.
* One unified report version.
* Summary-first structure.
* Daily compression with neutral topic sentence.
* Bullet-style patterns.
* Optional reflection section.
* Text-only design.
