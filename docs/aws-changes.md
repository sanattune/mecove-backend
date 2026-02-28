# AWS MVP Hardening & Operational Decisions

*Last updated: 2026-02-27*

This document records infrastructure decisions taken after initial MVP deployment of the MeCove backend on AWS.

---

# 1. SSH Access Removal (Security Hardening)

## Decision

Remove public SSH (port 22) access from EC2 security group.

## Rationale

* EC2 has a public Elastic IP.
* Keeping port 22 open increases attack surface.
* Session Manager (SSM) provides secure alternative access.

## Implementation

* Delete inbound rule for port 22 in EC2 security group.
* Use AWS Session Manager for terminal access.

## Outcome

* No public SSH exposure.
* Secure browser-based or CLI-based terminal access via SSM.
* Improved security posture.

---

# 2. Deployment Strategy (Manual via SSM)

## Decision

Use manual deployment triggered from SSM terminal.

## Flow

1. Connect to EC2 using Session Manager.
2. Run `/home/mecove/deploy.sh` as mecove user.
3. Script performs:

   * `git pull`
   * Install dependencies
   * Build
   * Reload secrets
   * Prisma migrations
   * PM2 restart

## Rationale

* Simple and controlled for MVP.
* No need to expose SSH.
* Avoid premature CI/CD complexity.

---

# 3. CloudWatch Logging

## Decision

Keep CloudWatch Logs enabled.
Reduce retention to 2–3 days.

## Rationale

* Required for debugging during MVP.
* Protects against loss of logs if EC2 becomes inaccessible.
* Short retention keeps storage cost minimal.

## Notes

* Ingestion cost is primary driver of CloudWatch expense.
* Avoid excessive logging of large raw payloads unless needed.

---

# 4. Elastic IP Usage

## Decision

Continue using Elastic IP.

## Rationale

* Required for public WhatsApp webhook endpoint.
* Ensures stable DNS mapping.
* No charge when attached to running EC2.

## DNS Setup

* Create A record in external DNS provider:

  * Name: `api`
  * Type: A
  * Value: Elastic IP

---

# 5. RDS Backup Enablement

## Decision

Enable automated backups for RDS.
Retention: 7 days.

## Rationale

* Protect against accidental data loss.
* Allow point-in-time recovery.
* Minimal cost impact at MVP scale.

## Not Enabled (For Now)

* Multi-AZ high availability
* Long-term retention

---

# 6. Redis Strategy

## Current State

* Redis runs locally on EC2 (systemd service).
* No persistence.
* Used for BullMQ queues and transient tracking.

## Decision

No persistence required for MVP.

## Rationale

* Core data is stored in PostgreSQL.
* Losing Redis state does not result in user data loss.
* Acceptable tradeoff for cost simplicity.

---

# 7. Scaling

## Decision

No scaling architecture changes at this stage.

## Rationale

* MVP traffic expected to be low.
* Single EC2 instance sufficient.
* Revisit if traffic or reliability requirements increase.

---

# Current Security Posture Summary

* Public ports: 80, 443 only
* No public SSH
* RDS accessible only from EC2 security group
* Secrets stored in AWS Secrets Manager
* CloudWatch enabled for observability
* Automated RDS backups enabled

---

# Overall Philosophy

This infrastructure remains:

* Cost-minimal
* Operationally observable
* Secure by default
* Simple to recover
* Appropriate for MVP stage

Further hardening and scaling decisions will be made only if real usage demands it.
