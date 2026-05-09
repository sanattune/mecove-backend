# meCove Report Changes for Developer

This document explains:
- what needs to change in each report
- why the change is needed
- where the change should be applied

The goal is to make the reports:
- emotionally safe for users
- structured for counsellors
- reflective without becoming interpretive or diagnostic

---

# Myself, Lately Report

## 1. Tone

### Where:
Across the entire report, especially:
- “What Has Been Coming Up”
- “Something to Notice”
- closing reflections

### Why:
Some sections currently feel analytical or slightly clinical.  
This report is user-facing and should feel emotionally safe and reflective.

### Change Needed:
- Make tone softer and more human
- Avoid emotionally heavy labels
- Keep language observational and narrative-based

### Example:
Instead of:
- “Recurring self-doubt”

Use:
- “Feedback seemed to feel personal across multiple moments”

---

## 2. Pattern Section

### Where:
“What Has Been Coming Up” section

### Why:
Direct pattern naming can feel like interpretation or judgement.

### Change Needed:
Convert patterns into natural reflective summaries.

### Example:
Instead of:
- “Workplace stress”
- “Recurring self-doubt”

Use:
- “Work conversations feeling heavier than they are”
- “Feedback seeming to affect more than just the work itself”

---

## 3. Emotion Display

### Where:
Entire user report

### Why:
Direct emotion vocabulary lists feel too explicit and psychologically heavy for users.

### Change Needed:
- Do NOT show standalone emotion lists
- Keep emotions embedded naturally inside quotes and summaries

---

## 4. “Worth Flagging” Section

### Where:
Current “Worth Flagging” section

### Why:
The phrase “flagging” can feel alarming or diagnostic.

### Change Needed:
Rename section to:
- “Something to Notice”

Keep the tone:
- observational
- gentle
- reflective

---

## 5. Add Gentle Reflection

### Where:
End of report

### Why:
The report currently ends abruptly after patterns.

A softer reflective close helps the report feel complete and human.

### Change Needed:
Add a short reflective takeaway that:
- highlights contrast
- encourages reflection
- avoids conclusions

### Example:
“There seems to be a contrast between how work feedback and music are experienced.”

---

## 6. Quotes

### Where:
All quote usage in the report

### Why:
Quotes are one of the strongest parts of the report because they preserve the user’s own language and meaning.

### Change Needed:
- Keep direct quotes wherever possible
- Use quotes to support patterns
- Keep surrounding summaries emotionally safe and contextual

---

## 7. Overall Structure

### Why:
Current flow can feel emotionally heavy early in the report.

### Suggested Order:
1. Time Window
2. What Has Been Coming Up
3. Moments That Stood Out
4. Something to Notice
5. Gentle Takeaway

---

# SessionBridge Report

## 1. Tone

### Where:
Entire report, especially headings and repeated patterns

### Why:
The report is counsellor-facing but should still avoid sounding clinical or diagnostic.

### Change Needed:
- Keep structured and neutral
- Avoid interpretive language
- Maintain human readability

---

## 2. Report Order

### Why:
Currently the vocabulary section appears too early and creates emotional heaviness immediately.

### New Order:
1. Time Window & Scope
2. Observed Themes
3. Signals Worth Attention
4. Moments of Variation
5. Decisions / Intentions
6. Words Used in Context
7. Daily Log

---

## 3. Words Used in Context Section

### Where:
Current “Recorded Vocabulary” section

### Why:
Standalone emotion words feel interpretive and disconnected from context.

The emotional meaning should remain attached to the original statement.

### Rename:
- “Recorded Vocabulary” → “Words Used in Context”

### Change Needed:
- Reduce visual importance
- Move lower in report
- Keep exact user wording only
- No emotional categorization
- Emotion words should never appear standalone

### Format:
Use a compact table format:

| Statement / Context | Reflects |
|---|---|
| “scared of just pretending to understand” | fear |
| “feel exposed by reviews” | exposure |

### Purpose:
- Preserve nuance
- Avoid interpretation
- Keep emotional meaning connected to context

---

## 4. Add New Section

### New Section:
“Signals Worth Attention”

### Why:
Repeated patterns are important for counsellors to notice but should not feel diagnostic.

### Purpose:
Highlight repeated themes such as:
- repeated self-doubt
- exhaustion
- feedback linked to identity

### Important Rules:
- Must be repetition-based
- No interpretation
- No advice
- No conclusions about personality

---

## 5. Add “Moments of Variation”

### Where:
Before “Decisions / Intentions”

### Why:
The report currently focuses heavily on distress patterns.

Showing emotional variation creates balance and gives counsellors broader context.

### Change Needed:
Highlight moments connected to:
- music
- curiosity
- enjoyment
- relief
- self-expression

---

## 6. Interpretation Rules

### Where:
Entire report generation logic

### Why:
The report must remain reflective, not diagnostic.

### Avoid:
- “User is anxious”
- “User has low confidence”
- “User struggles with criticism”

### Use:
- “Self-doubt appeared across multiple entries”
- “Feedback repeatedly linked with identity”

---

## 7. Data Rules

### Where:
Backend report generation logic

### Why:
The product philosophy is based on reflection using only explicit user-entered data.

### Rules:
- Only use explicitly written content
- No inferred meaning
- No diagnosis
- No recommendations
- No psychological categorization

---

## 8. Daily Log

### Where:
Appendix / raw log section

### Why:
This section preserves chronological context and original meaning.

### Change Needed:
- Keep raw structure
- Keep chronological order
- No summarization
- No interpretation
