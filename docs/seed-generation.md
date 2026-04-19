# Seed Generation Guide

This project supports a two-step seed workflow:

1. Create chat-log data in the existing `ChatDay[]` JSON format.
2. Insert that data into the database for a WhatsApp phone number.

Use this when creating realistic test histories for personas, summary testing, reply testing, or local demos.

## File-Based Report Fixtures

Use this workflow when you want generated test data and a SessionBridge report without writing any messages to the database.

1. Create a gitignored fixture folder:

```txt
test-data/generated/<persona-slug>/
```

2. Copy the persona template:

```txt
docs/chat-persona-template.md
```

to:

```txt
test-data/generated/<persona-slug>/persona.md
```

3. Create the chat log:

```txt
test-data/generated/<persona-slug>/chatlog.json
```

4. Generate report artifacts:

```bash
pnpm report:fixture test-data/generated/<persona-slug> --days 15
```

The fixture script writes:

- `window-bundle.json`
- `canonical.json`
- `draft-s2-s3.json`
- `draft-s4.json`
- `final-sections.json`
- `report.md`
- `report.pdf`
- `summary-meta.json`

This path does not seed messages into the DB. It builds a `WindowBundle` directly from `chatlog.json`; only user messages (`u`) are summarized.

Clean generated report artifacts for one persona while keeping `persona.md` and `chatlog.json`:

```bash
pnpm report:fixture:clean test-data/generated/<persona-slug>
```

You can also use only the slug:

```bash
pnpm report:fixture:clean <persona-slug>
```

Clean generated report artifacts for all personas:

```bash
pnpm report:fixture:clean --all
```

Preview cleanup without deleting:

```bash
pnpm report:fixture:clean --all --dry-run
```

## Recommended Workflow

For curated persona datasets, manually create a JSON file under `seed/chat-data/`.

Example path:

```txt
seed/chat-data/confused-male-student-17.json
```

Then seed it into the DB:

```bash
pnpm seed:chat seed/chat-data/confused-male-student-17.json --phone +919876543210 --clear
```

What this does:

- Finds or creates a `User` through a WhatsApp `Identity`.
- Uses `channel = "whatsapp"`.
- Uses the normalized phone number as `channelUserKey`.
- Optionally deletes existing messages for that user when `--clear` is passed.
- Inserts or updates messages using `(identityId, sourceMessageId)`.
- Encrypts `text` and `replyText` at rest using the user's DEK.

## Chat JSON Format

The seed file must be a JSON array of days:

```json
[
  {
    "day": 1,
    "chat": [
      {
        "index": 1,
        "u": "I felt anxious before work today.",
        "r": "Got it."
      },
      {
        "index": 2,
        "u": "My manager asked a question and I started doubting myself.",
        "r": "Noted."
      }
    ]
  },
  {
    "day": 2
  }
]
```

Fields:

- `day`: Calendar day number in the generated history.
- `chat`: Optional list of messages for that day.
- `index`: Message number within the day.
- `u`: User message text.
- `r`: Bot reply text stored on the same `Message` row as `replyText`.

Blank days are valid. A day without `chat` creates no messages.

## Timeline Behavior

The seeder treats day 1 as 15 days before the day the script runs.

For each day with chat:

- Messages start around 9 AM.
- Messages are distributed across roughly 15 hours.
- Reply metadata is stored one minute after each user message.

The seeder does not create separate bot-message rows. Bot replies are stored as `replyText` and `repliedAt` on user `Message` rows.

## Commands

Seed a JSON file:

```bash
pnpm seed:chat seed/chat-data/my-scenario.json --phone +919876543210
```

Seed and clear that user's previous messages first:

```bash
pnpm seed:chat seed/chat-data/my-scenario.json --phone +919876543210 --clear
```

Use the default file, `seed/chat-data/chat1.json`:

```bash
pnpm seed:chat --phone +919876543210 --clear
```

AWS example:

```bash
sudo -u mecove bash -lc 'cd /home/mecove/app && pnpm seed:chat seed/chat-data/my-scenario.json --phone +919876543210 --clear'
```

## LLM YAML Generation

There is also an LLM-powered generator:

```bash
pnpm seed:generate
```

By default it reads:

```txt
seed/seed-input.yaml
```

You can pass a custom YAML path:

```bash
pnpm seed:generate seed/my-scenario.yaml
```

Example YAML:

```yaml
phone: "+919876543210"
persona: "anxious grad student preparing for thesis defense"
arc: "starts stressed and overwhelmed, gradually finds coping strategies, ends cautiously optimistic"
days: 10
messages: "2-5"
gap: 2
output: "seed/chat-data/my-scenario.json"
seedDb: true
clear: true
```

Fields:

- `phone`: WhatsApp phone number used when `seedDb: true`.
- `persona`: Persona description driving the generated content.
- `arc`: Emotional or narrative arc across generated days.
- `days`: Number of active chat days.
- `messages`: Messages per active day, as `"min-max"`.
- `gap`: Average gap between active days. Actual gaps vary by plus/minus 1 day.
- `output`: Optional JSON output path.
- `seedDb`: If true, seed into the DB after generation.
- `clear`: If true and `seedDb` is true, clear existing messages for that user first.

## Manual vs LLM Generation

Use manual JSON when:

- You need stable, reviewable test data.
- You want precise themes, risk moments, or writing style.
- You want to reuse the same dataset repeatedly.

Use LLM YAML generation when:

- You want quick synthetic data.
- Exact wording is less important.
- You want randomized day/message counts and faster scenario exploration.

The preferred workflow for high-signal test personas is manual JSON generation, then `pnpm seed:chat`.

## Safety and Realism Notes

For personas involving self-harm, panic, abuse, substance use, or other high-risk content:

- Keep the content realistic but not gratuitous.
- Include only the amount needed for testing.
- Keep follow-up messages consistent with how the app stores replies.
- Prefer a broader life context rather than making every day crisis-heavy.

## Current Script Files

- `seed/seedChatData.ts`: Imports existing JSON data into the DB.
- `seed/generateChatData.ts`: Uses an LLM and YAML config to generate JSON data.
- `seed/seed-input.yaml`: Example YAML config for LLM generation.
- `seed/chat-data/`: Stored seed JSON datasets.
