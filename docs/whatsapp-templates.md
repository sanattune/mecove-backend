# WhatsApp Message Templates — submission runbook

Submission-ready specs for the WhatsApp templates the backend needs (see
`docs/plans/plan_whatsapp-messaging.md`). **Submit these in Meta WhatsApp Manager now**
— approval has lead time and gates all WhatsApp delivery. Code is built once they're
approved.

**Where:** Meta Business Suite → WhatsApp Manager → **Message Templates → Create template**.
The business sender (our existing WhatsApp Business number) is already live.

When approved, record each template's **exact name** + **language code** and set the
corresponding env var (below). Template names are immutable once created — pick final
names now.

---

## 1. OTP — `mecove_otp`  (env: `WHATSAPP_OTP_TEMPLATE_NAME`)

- **Category:** Authentication
- **Name:** `mecove_otp`
- **Language:** English — `en` (or `en_US`)
- **Code delivery:** **Copy code** button
- **Code expiration:** **10 minutes** (must match our Redis OTP TTL)
- **Body:** Authentication templates use Meta's fixed format — you don't free-type the
  body. It renders as:
  > *{{1}}* is your verification code. For your security, do not share this code.
  - With the security disclaimer + "This code expires in 10 minutes." auto-added.
- **Parameters:** 1 — the OTP code (`{{1}}`), passed as the body + button component.
- **Add-on options:** leave "Add security recommendation" and "Expiration time for the
  code" ON.

## 2. Professional invite — `mecove_pro_invite`  (env: `WHATSAPP_INVITE_TEMPLATE_NAME`)

- **Category:** Utility  (if Meta reclassifies as Marketing, resubmit as Marketing)
- **Name:** `mecove_pro_invite`
- **Language:** English — `en`
- **Body (proposed copy — adjust freely):**
  > Hi! {{1}}, a {{2}} on meCove, has invited you to connect so you can choose to share
  > your reflections with them. Install meCove and sign in with this number to accept.
  - **Parameters:** `{{1}}` = professional display name, `{{2}}` = professional type
    (therapist / counsellor / coach).
- **Button:** NONE for now — the app isn't on a store yet, so there's no install URL.
  Add a URL button (App Store / Play Store) at store launch and bump the template.
- **Footer (optional):** "You can ignore this message if you weren't expecting it."

---

## Notes / open items
- **insight-request nudge (D8)** may need a 3rd template if it's always sent to
  out-of-session clients. Decide during Phase 6 build; if clients are typically in a 24h
  WhatsApp session, free-form text suffices and no template is needed.
- **Engagement event notifications** (accepted / shared / ended): in-session → free-form;
  out-of-session → would need a Utility template each. Defer until we see whether
  recipients are reachable in-session; add here if needed.
- Authentication-category templates are usually approved quickly; Utility can take longer.
- After approval, set env vars in each environment and confirm with a test send to a
  WhatsApp-enabled number before flipping OTP off SMS.
