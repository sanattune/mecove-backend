# SessionBridge Summary Generation Design (MVP+)

## 1. Goal

Design a reliable generation flow for the 15-day summary so output is:

- Neutral and coach-safe
- Structurally consistent
- Non-interpretive
- Auditable and debuggable

This is the most important output in the system and should not rely on a single free-form prompt.

## 2. Core Architecture

Use a staged pipeline with deterministic control points:

1. Stage A: Canonicalizer (LLM or rule-assisted)
2. Stage B: Planner (deterministic logic)
3. Stage C: Writer (LLM)
4. Stage D: Policy Gate (deterministic checks + LLM judge)
5. Stage E: Repair (LLM, targeted)

Principle: Deterministic components decide structure and policy; LLM is used mainly for constrained writing.

## 3. Stage Details

### Stage A: Canonicalizer

Input:

- Raw user messages for the last 15 calendar days
- Timestamps

Output (JSON only):

- `days`: calendar-day buckets
- `per_day`: factual points from user text
- `explicit_emotions`: only emotions explicitly stated by user
- `numeric_logs`: numeric values preserved exactly
- `signal_indicators`: data density/coverage hints

Rules:

- No interpretation
- No inferred causes
- No advice
- No invention

### Stage B: Planner (Deterministic)

Input:

- Canonicalized JSON from Stage A

Computes:

- `days_with_entries`
- `total_entries`
- repetition frequencies
- low/medium/high signal bucket

Outputs `report_plan.json`:

- Fixed section order
- Section inclusion decisions
- Bullet counts
- Limits statement requirements
- Safe wording constraints

Section inclusion rules:

1. Section 1 (Time Window & Scope): always
2. Section 2 (Observed Patterns & Limits): always
3. Section 3 (Open Points for Reflection): optional only when defensible
4. Section 4 (Logged Moments): always, max one entry per calendar day, max 15 days

### Stage C: Writer

Input:

- `report_plan.json`
- Canonicalized facts

Output:

- Final user-facing summary text in exact 4-section format

Hard constraints:

- No advice
- No causality
- No diagnosis
- No motivation framing
- No invented facts
- Section 3 statements only (not questions)

### Stage D: Policy Gate

Two layers:

1. Deterministic lint:
   - Required sections exist
   - Section order is correct
   - Optional section rules respected
   - No extra sections

2. LLM policy judge:
   - Pass/fail
   - Violation reasons with text spans

### Stage E: Repair

If Stage D fails:

1. Run targeted rewrite with listed violations
2. Retry up to 2 times
3. If still failing, emit minimal safe fallback:
   - Section 1
   - Section 2 with limits emphasis
   - Section 4 concise day reconstruction

## 4. Adaptive Logic

1. `days_with_entries <= 2`
   - Minimal structure
   - Patterns may collapse into limits
   - Section 3 disabled

2. `days_with_entries = 3..5`
   - Cautious pattern bullets
   - Section 3 only if repeated explicit signal exists

3. `days_with_entries >= 6`
   - Fuller pattern bullets without causality
   - Section 3 allowed, max 3 statements

Principle:

The report should never sound more confident than the data.

## 5. Data Contracts and Versioning

Persist for each generated summary:

- `input_hash`
- `planner_version`
- `prompt_version_canonicalizer`
- `prompt_version_writer`
- `policy_gate_version`
- `repair_attempts`

Store intermediate artifacts (canonical JSON, plan JSON, lint results) for auditability.

## 6. Operational Behavior

1. Request handling:
   - User requests summary
   - If no active summary job: accept and start
   - If active job exists: return "previous summary is still being generated"

2. In-flight lock:
   - Redis key per user
   - 15-minute TTL
   - Clear on completion/failure

3. Timeout:
   - Hard timeout at 15 minutes
   - User receives timeout notification

4. Idempotency:
   - Avoid duplicate generations for same user + window + input hash

## 7. Quality Metrics

Track:

1. First-pass policy gate success rate
2. Repair rate
3. Section rule compliance rate
4. Neutrality review score
5. Hallucination/unsupported statement incidents

## 8. Why This Design

This design prevents a single large prompt from controlling policy, structure, and prose simultaneously. It improves reliability by splitting responsibilities:

- deterministic planning for rules
- constrained generation for language quality
- explicit policy checks for safety and trust
