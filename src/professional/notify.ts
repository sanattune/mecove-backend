import { logger } from "../infra/logger";
import { sendWhatsAppTemplate, WHATSAPP_TEMPLATES } from "../infra/whatsapp";

/**
 * Professional-support outbound notifications over WhatsApp (Phase 6).
 *
 * These are best-effort: a send failure must never fail the originating request
 * (e.g. opening an engagement still succeeds even if the invite WhatsApp bounces).
 * Callers log-and-continue; this module throws on failure so callers can decide.
 */

/**
 * Invites a not-yet-registered client to meCove when a professional opens an engagement
 * against a cold phone (no account). Uses the approved `mecove_pro_invite` template:
 *   "Hi! Your {{1}} {{2}} has set up meCove for you ..."  ({{1}}=type, {{2}}=name)
 *
 * @param toPhone E.164 phone (with leading "+"); normalized to bare digits here.
 * @param professionalType therapist | counsellor | coach — fills {{1}}.
 * @param displayName professional's display name — fills {{2}}.
 */
export async function sendProInviteWhatsApp(
  toPhone: string,
  professionalType: string,
  displayName: string
): Promise<void> {
  const toDigits = toPhone.replace(/\D/g, "");
  const { name, lang } = WHATSAPP_TEMPLATES.proInvite;
  await sendWhatsAppTemplate(toDigits, name, lang, [
    {
      type: "body",
      parameters: [
        { type: "text", text: professionalType },
        { type: "text", text: displayName },
      ],
    },
  ]);
  logger.info({ phone: `****${toPhone.slice(-4)}`, professionalType }, "pro invite WhatsApp sent");
}
