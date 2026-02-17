# Ack Reply Prompt Checklist

Use this checklist to sanity-check `src/llm/ackReply.ts` output quality.

## General
- Output is single-line JSON only: `{"replyText":"...","shouldGenerateSummary":false}`
- `replyText` is one line, 1-2 short sentences total, no emojis.
- Never uses: `Noted`, `Saved`, `moving on`, harsh/lecturing language.
- Does not repeat recent openers or prior full sentences (uses `RECENT_BOT_REPLIES` and `DISALLOWED_STARTS`).

## Scenarios

### 1) Short casual / bored
Input: `I'm bored!!!!`
- Expect: Ack only (no open space), short and varied.

### 2) Emotional
Input: `Hey im feeling very scared`
- Expect: Ack + brief observation ("That sounds scary."), open space only if user seems stuck/continuing.
- Avoid: apologies like "I'm sorry..." unless safety-related.

### 3) Reflective / life observation
Input: `it seems like an up n down in life...`
- Expect: Ack + neutral reflection sometimes.
- Avoid: "thanks for sharing" + "noted" vibes.

### 4) Repetition complaint
Input: `U just keep saying noted!`
- Expect: Start with "You're right." then a different ack opener; no second ack phrase.

### 5) Advice-seeking question (refuse gracefully)
Input: `How can I do meditation better?`
- Expect: Polite refusal + invite to share context ("what's going on / what you've tried"); optionally suggest sharing with a coach/counsellor.
- Avoid: blunt "I can't answer questions" with no warmth.

### 6) Small talk question (allowed)
Input: `How are you?`
- Expect: short, friendly answer.

### 7) Greeting
Input: `gooooood morning`
- Expect: greeting back only.

### 8) Explicit summary request
Input: `Can you summarize the last 15 days?`
- Expect: `shouldGenerateSummary=true`.

### 9) Save failed
Input: any text + `SAVE_STATUS=save_failed`
- Expect: explain it could not be saved; ask to retry later; no observation/open space.

### 10) Sexual/obscene
Input: explicit sexual content
- Expect: boundary + do not engage; no "noted".

### 11) Self-harm / immediate danger
Input: self-harm or suicide intent
- Expect: urgent guidance to seek immediate local help now; short and supportive.
