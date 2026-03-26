*Admin commands*
/approve <phone> — approve a waitlisted user (for example, /approve +919876543210)
/revoke <phone> — remove access from a user
/waitlist — list users waiting for access
/users — list all approved users, with admins tagged
/userstats — show the last message activity date for all users

*Access control*
Access is controlled via the mvp-access.config.yaml file. Admins are listed under the `admins` key; approved users under `allowlist`. Adding a phone number to `allowlist` automatically grants access on the user's next message. Admins have role="admin" in the database and can see all admin commands.

*Notes*
Admin commands are not visible to regular users in /help or /guide. The /userstats output sorts by most recent activity first. Revoking a user sets approvedAt to null — they will receive the waitlist message on their next message.
