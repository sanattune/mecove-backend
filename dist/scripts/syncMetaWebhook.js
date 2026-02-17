"use strict";
try {
    require("dotenv/config");
}
catch { /* dotenv optional in Docker */ }
const NGROK_ADMIN_URL = process.env.NGROK_ADMIN_URL?.trim() || "http://localhost:4040";
const WHATSAPP_APP_ID = process.env.WHATSAPP_APP_ID?.trim();
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET?.trim();
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
if (!WHATSAPP_APP_ID || !WHATSAPP_APP_SECRET || !WHATSAPP_VERIFY_TOKEN) {
    console.error("Missing required env: WHATSAPP_APP_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN");
    process.exit(1);
}
async function main() {
    const tunnelsRes = await fetch(`${NGROK_ADMIN_URL}/api/tunnels`);
    if (!tunnelsRes.ok) {
        const text = await tunnelsRes.text();
        console.error("Ngrok tunnels request failed:", tunnelsRes.status, text);
        process.exit(1);
    }
    const tunnelsData = (await tunnelsRes.json());
    const tunnels = tunnelsData.tunnels ?? [];
    const httpsTunnel = tunnels.find((t) => t.public_url?.startsWith("https://"));
    if (!httpsTunnel?.public_url) {
        console.error("No HTTPS tunnel found. Is ngrok running?");
        process.exit(1);
    }
    const callbackUrl = `${httpsTunnel.public_url.replace(/\/$/, "")}/webhooks/whatsapp`;
    const appAccessToken = `${WHATSAPP_APP_ID}|${WHATSAPP_APP_SECRET}`;
    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_APP_ID}/subscriptions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${appAccessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            object: "whatsapp_business_account",
            callback_url: callbackUrl,
            verify_token: WHATSAPP_VERIFY_TOKEN,
            fields: ["messages"],
        }),
    });
    if (!metaRes.ok) {
        const errJson = await metaRes.json().catch(() => ({}));
        console.error(JSON.stringify(errJson, null, 2));
        process.exit(1);
    }
    console.log(`✅ Meta webhook updated: ${callbackUrl}`);
}
main();
