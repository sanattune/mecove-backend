# Ack Reply System — How It Works

## Overview

The ack reply system (`src/llm/ackReply.ts`) generates short acknowledgment replies to user WhatsApp messages. It combines an LLM-generated reply with deterministic ack phrase rotation to prevent repetitive openers like "Thanks for sharing" on every message.

## Architecture

```
User message → generateAckDecision()
                  │
                  ├─ 1. Fetch last 10 messages from DB (with replyTexts)
                  ├─ 2. selectAckPhrase() — pick next ack based on last reply's opener
                  ├─ 3. Render prompt with conversation history
                  ├─ 4. LLM generates full replyText (including its own ack opener)
                  ├─ 5. parseAckDecision() — extract replyText + shouldGenerateSummary
                  └─ 6. swapAckPhrase() — replace LLM's ack opener with rotated one
                          │
                          └─ Final replyText sent to user
```

## Key Design Decision: Swap, Don't Instruct

We tried several approaches to prevent repetitive ack phrases:

1. **DISALLOWED_STARTS blacklist** (original) — LLM told "don't start with X". Failed because LLMs are bad at negation, especially cheap models like gpt-4.1-nano.
2. **Multi-field JSON** (`observation`/`openSpace` separate fields) — LLM told to omit ack, system prepends. Failed because nano compulsively fills every field, producing unwanted questions and third-person text ("User is considering...").
3. **Single replyText + "don't include ack" instruction** — LLM told system will prepend ack. Failed because nano ignores the instruction and includes an ack anyway, causing doubles ("Thanks for sharing. Thanks for sharing.").
4. **Swap approach (current)** — LLM writes full replyText exactly like it always did (unchanged prompt/format). Code post-processes: strips whatever ack the LLM used, prepends the rotated one. Works because it requires zero LLM behavior change.

**Lesson:** With budget models (gpt-4.1-nano), don't ask the LLM to change its output format. Keep the prompt identical to what works, then post-process deterministically in code.

## Deterministic Ack Phrase Rotation

### The phrase list (10 phrases)

```typescript
const ACK_PHRASES = [
  "Got it.", "Heard.", "Noted.", "Thanks for sharing.", "Taken note.",
  "Okay.", "Captured.", "Written down.", "Alright.", "Received.",
];
```

### `selectAckPhrase(recentReplyTexts)`

- Takes the array of recent bot reply texts (oldest first)
- Looks at the **last** reply only
- Finds which ACK_PHRASE it starts with
- Returns the **next** phrase in the list (wrapping around)
- If the last reply doesn't match any phrase (old format, edge case), starts from index 0

This guarantees consecutive replies always use different ack phrases.

### `swapAckPhrase(replyText, ackPhrase)`

- Takes the LLM's full replyText and the chosen ack phrase
- If replyText starts with any known ACK_PHRASE: strips it, prepends the rotated one
  - `"Got it. That's a lot of pressure."` + ack=`"Noted."` → `"Noted. That's a lot of pressure."`
  - `"Thanks for sharing."` + ack=`"Heard."` → `"Heard."`
- If replyText does NOT start with any known ACK_PHRASE: returns as-is (no swap)
  - `"Good morning."` → `"Good morning."` (greeting, no ack needed)
  - `"That sounds scary. What's going on?"` → unchanged (feeling-reflection opener, not an ack)
  - `"I hear you. Please reach out to a crisis helpline."` → unchanged (safety response)

This is the key insight: **edge cases (greetings, closings, safety, feeling-reflections) naturally don't start with an ACK_PHRASE**, so they pass through untouched without needing any special `isEdgeCase` flag.

## LLM Prompt

The prompt is intentionally close to the original working version. Key points:

- **Output format:** `{"replyText":"<text>","shouldGenerateSummary":<bool>}` — just 2 fields, same as always
- **Reply structure:** Ack (required) + Observation (optional) + Open space (optional)
- **No DISALLOWED_STARTS** — removed since rotation handles it in code
- **No ack-varying instructions** — removed since the LLM's ack choice gets swapped anyway
- The LLM still writes ack phrases naturally (it's told to vary them, and it tries). The code just overrides whatever it picked.

### Prompt inputs

| Variable | Source | Purpose |
|---|---|---|
| `SAVE_STATUS` | Caller | "saved" or "save_failed" |
| `MESSAGES` | Last 10 DB messages | Conversation context |
| `LAST_BOT_REPLY` | Most recent bot line | Detect if bot asked a question |
| `LAST_BOT_REPLY_WAS_QUESTION` | Ends with "?" | Controls open space decisions |
| `RECENT_BOT_REPLIES` | Last 3 bot lines | Avoid repeating recent replies |
| `USER_REPLYING_HINT` | Conditional | Injected when LAST_BOT_REPLY_WAS_QUESTION=true |
| `LATEST_USER_MESSAGE` | Caller | The new batched message(s) |

### Open space (follow-up question) rules

The LLM decides whether to ask a question based on:
- **DO ask:** LAST_BOT_REPLY_WAS_QUESTION=false AND user introducing new/emotional topic
- **DON'T ask:** LAST_BOT_REPLY_WAS_QUESTION=true (user answering prior question), routine updates, greetings/closings, already asked in 2 of last 3 replies

### Edge case handling (all handled by LLM in replyText)

| Case | LLM behavior | swapAckPhrase behavior |
|---|---|---|
| Greeting ("good morning") | Replies with greeting | No swap (no ACK_PHRASE match) |
| Closing ("bye", "good night") | Replies politely | No swap |
| Safety (self-harm) | Crisis response or reflection | No swap |
| Sexual content | Sets boundary | No swap |
| Save failed | Error message | No swap |
| Summary request | Brief ack, shouldGenerateSummary=true | Swaps ack (starts with "Got it." etc.) |
| Repetition complaint | "You're right." + fresh reply | No swap ("You're right." not in ACK_PHRASES) |
| Routine journal entry | Just an ack ("Got it.") | Swaps to rotated ack |
| Emotional/reflective | Ack + reflection +/- question | Swaps ack, keeps rest |

## Temperature Support

Added in this change across the LLM stack:

- `CompleteOptions.temperature` and `ResolvedModelConfig.temperature` in `src/llm/types.ts`
- Read from YAML model config in `src/llm/config.ts`
- Passed through to all 3 API providers (groq, openai, sarvam) in `src/llm/llmViaApi.ts`
- Set to `temperature: 1.0` for gpt-4.1-nano in `src/llm/llm.yaml` to increase output variety

## Files

| File | What changed |
|---|---|
| `src/llm/ackReply.ts` | Added ACK_PHRASES, selectAckPhrase, swapAckPhrase. Removed DISALLOWED_STARTS, normalizeReplyStart, buildDisallowedStartsFromRecentBotReplies. Simplified prompt (removed ack-specific instructions). Added swapAckPhrase call after LLM returns. |
| `src/llm/types.ts` | Added `temperature?: number` to CompleteOptions and ResolvedModelConfig |
| `src/llm/config.ts` | Added `temperature` to RawModel type, passes through to ResolvedModelConfig |
| `src/llm/llmViaApi.ts` | All 3 providers now include `temperature` in API request body when set |
| `src/llm/llm.yaml` | Added `temperature: 1.0` to gpt-4.1-nano entry |
