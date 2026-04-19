# LLM Pipeline (`src/llm/`)

## Directory structure

```
src/llm/
  classify/         — ackClassify.ts (micro-classifier)
  reply/
    ack/            — ackReply.ts (full ACK_PROMPT pipeline)
    greeting/       — greetingReply.ts
    guide/          — guideReply.ts
  context/          — messageContext.ts (shared message fetch/decrypt/format)
  config.ts         — YAML-driven model selection
  llmViaApi.ts      — unified LLM client
  llm.yaml          — provider/model config
  types.ts, index.ts
```

# Reply Pipeline

Two-stage reply pipeline orchestrated by `ackReply.ts`:

**Stage 1 — micro-classifier** (`ackClassify.ts`): cheap LLM call. Classifies into: `greeting`, `closing`, `trivial`, `summary_request`, `guide_query`, `setup_checkin`, `journal_entry`. Receives the last 3 exchanges (up to 6 lines) as `RECENT_CONTEXT` for disambiguation. Simple cases are handled directly without Stage 2. Classifier descriptions are intent-based (not phrase lists) so the LLM uses its full language understanding. Hard rule: emotional content always → `journal_entry`, even when `LAST_BOT_REPLY_WAS_QUESTION=true` — emotional weight overrides the question-answer heuristic.

**Stage 2 — full ACK_PROMPT**: only runs for `journal_entry`. Uses last 10 messages of conversation history, applies safety policies, reply composition rules, and question-asking logic.

The classifier result is returned as `classifierType` on `AckDecision` and persisted to `Message.classifierType` by the worker. This is used downstream for engagement scoring (see `src/commands/CLAUDE.md`).

## Routing by classification

- **`greeting`** → `greetingReply.ts` — personalized greetings based on time gap since last message:
  - < 5 hours: simple classifier greeting (no extra LLM call)
  - 5h – 3 days: one cheap LLM call with last 15 messages to find an open thread and reference it naturally
  - 3+ days: warm "it's been a while" template (no LLM)
- **`closing`** → direct classifier reply. Prompt enforces time-neutral phrasing (no "Good night/morning/evening") and instructs the LLM to vary naturally — examples in the prompt are illustrative only.
- **`trivial`** → classifier reply with ack phrase rotation
- **`summary_request`** → ack phrase + triggers summary pipeline
- **`setup_checkin`** → sets `shouldSetupCheckin: true` on `AckDecision`; worker calls `handleCheckinIntent()` to send time-selection buttons, then tags all messages in the batch as `command_reply` so they're excluded from future LLM context
- **`guide_query`** → `guideReply.ts` — answers using guide content
- **`journal_entry`** → Stage 2 full ACK_PROMPT

## Shared message context helper

`messageContext.ts` — `fetchFormattedMessageLines(userId, options)`: fetches, decrypts, and formats recent messages as `User: X` / `<botLabel>: Y` lines for LLM prompts. Used by `ackReply.ts`, `greetingReply.ts`, and `nudgeReply.ts`. Options: `fetchLimit`, `targetCount`, `skipFirst` (exclude most-recent message), `botLabel`.

## LLM config

YAML-driven model selection (`llm.yaml` + `config.ts`). Models chosen by `complexity` (low/medium/high) and `reasoning` (true/false). Multiple providers supported: OpenAI, Groq, Sarvam.
