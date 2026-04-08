# Reply Pipeline (`src/llm/`)

Two-stage reply pipeline orchestrated by `ackReply.ts`:

**Stage 1 — micro-classifier** (`ackClassify.ts`): cheap LLM call. Classifies into: `greeting`, `closing`, `trivial`, `summary_request`, `guide_query`, `other`. Receives the last 3 exchanges (up to 6 lines) as `RECENT_CONTEXT` for disambiguation. Simple cases are handled directly without Stage 2. Classifier descriptions are intent-based (not phrase lists) so the LLM uses its full language understanding.

**Stage 2 — full ACK_PROMPT**: only runs for `other`. Uses last 10 messages of conversation history, applies safety policies, reply composition rules, and question-asking logic.

## Routing by classification

- **`greeting`** → `greetingReply.ts` — personalized greetings based on time gap since last message:
  - < 5 hours: simple classifier greeting (no extra LLM call)
  - 5h – 3 days: one cheap LLM call with last 15 messages to find an open thread and reference it naturally
  - 3+ days: warm "it's been a while" template (no LLM)
- **`closing`** → direct classifier reply
- **`trivial`** → classifier reply with ack phrase rotation
- **`summary_request`** → ack phrase + triggers summary pipeline
- **`guide_query`** → `guideReply.ts` — answers using guide content
- **`other`** → Stage 2 full ACK_PROMPT

## LLM config

YAML-driven model selection (`llm.yaml` + `config.ts`). Models chosen by `complexity` (low/medium/high) and `reasoning` (true/false). Multiple providers supported: OpenAI, Groq, Sarvam.
