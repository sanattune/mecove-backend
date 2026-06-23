import type { FastifyInstance } from "fastify";
import { authenticate, requireProfessional } from "./middleware/auth";
import { handleRequestOtp, handleVerifyOtp, handleRefreshToken, handleLogout } from "./handlers/authHandler";
import { handleGetMessages, handleSendMessage } from "./handlers/messageHandler";
import { handleGenerateInsight, handleGetInsight, handleGetInsightPdf } from "./handlers/insightHandler";
import { handleGetCheckin, handleSetupCheckin } from "./handlers/checkinHandler";
import { handleGetStats, handleDeleteAccountData, handleGetPrivacy, handleAcceptPrivacy } from "./handlers/accountHandler";
import { handleCreateProfessionalProfile, handleListProfessionalProfiles } from "./handlers/professionalHandler";
import { handleCreateEngagement, handleListProfessionalEngagements, handleListClientEngagements, handleAcceptEngagement, handleEndEngagementByClient, handleEndEngagementByPro } from "./handlers/engagementHandler";
import { handleShareInsight, handleUnshareInsight, handleSetAutoSend, handleListSharedInsights, handleGetSharedInsightPdf } from "./handlers/shareHandler";

const S = {
  Error: {
    type: "object",
    properties: {
      error: { type: "string" },
      message: { type: "string" },
    },
  },
  MessageItem: {
    type: "object",
    properties: {
      id: { type: "string" },
      role: { type: "string", enum: ["user", "assistant"] },
      content: { type: "string" },
      timestamp: { type: "string", format: "date-time" },
    },
  },
  ProfessionalProfile: {
    type: "object",
    properties: {
      id: { type: "string" },
      professionalType: { type: "string", enum: ["therapist", "counsellor", "coach"] },
      displayName: { type: "string" },
      additionalTitle: { type: "string", nullable: true },
      verificationStatus: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  Engagement: {
    type: "object",
    properties: {
      id: { type: "string" },
      professionalId: { type: "string" },
      status: { type: "string", enum: ["pending", "active", "ended"] },
      startDate: { type: "string", format: "date-time", nullable: true },
      endDate: { type: "string", format: "date-time", nullable: true },
      autoSendSessionBridge: { type: "boolean" },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      endedAt: { type: "string", format: "date-time", nullable: true },
      endedBy: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      client: {
        type: "object",
        nullable: true,
        properties: {
          userId: { type: "string" },
          phone: { type: "string", nullable: true },
          displayName: { type: "string", nullable: true },
        },
      },
      inviteePhone: { type: "string", nullable: true },
    },
  },
  ClientEngagement: {
    type: "object",
    properties: {
      id: { type: "string" },
      professionalId: { type: "string" },
      status: { type: "string", enum: ["pending", "active", "ended"] },
      startDate: { type: "string", format: "date-time", nullable: true },
      endDate: { type: "string", format: "date-time", nullable: true },
      autoSendSessionBridge: { type: "boolean" },
      acceptedAt: { type: "string", format: "date-time", nullable: true },
      endedAt: { type: "string", format: "date-time", nullable: true },
      endedBy: { type: "string", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      inviteePhone: { type: "string", nullable: true },
      professional: {
        type: "object",
        properties: {
          professionalId: { type: "string" },
          displayName: { type: "string" },
          professionalType: { type: "string" },
          additionalTitle: { type: "string", nullable: true },
          verificationStatus: { type: "string" },
        },
      },
    },
  },
} as const;

export async function restPlugin(app: FastifyInstance): Promise<void> {
  // Accept empty JSON bodies — Android client sends Content-Type: application/json with no body
  // on no-payload POSTs. This override is scoped to the REST plugin; WA plugin has its own.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (!body || (body as string).trim() === "") {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      const parseError = err instanceof Error ? err : new Error("Invalid JSON body.");
      (parseError as Error & { statusCode: number }).statusCode = 400;
      done(parseError, undefined);
    }
  });

  // ── Auth ──────────────────────────────────────────────────────────────────────

  app.post("/auth/request-otp", {
    schema: {
      tags: ["Auth"],
      summary: "Request OTP",
      description: "Sends a 6-digit OTP via SMS. Rate limited to 3 requests per 15 minutes per phone number.",
      body: {
        type: "object",
        required: ["phoneNumber"],
        properties: {
          phoneNumber: { type: "string", description: "E.164 format", example: "+919876543210" },
        },
      },
      response: {
        200: { type: "object", properties: { success: { type: "boolean" } } },
        400: S.Error,
        429: S.Error,
      },
    },
  }, handleRequestOtp);

  app.post("/auth/verify", {
    schema: {
      tags: ["Auth"],
      summary: "Verify OTP and sign in",
      description: "Verifies the OTP and returns a JWT access token and refresh token. Creates the user if this is their first sign-in.",
      body: {
        type: "object",
        required: ["phoneNumber", "otp"],
        properties: {
          phoneNumber: { type: "string", example: "+919876543210" },
          otp: { type: "string", minLength: 6, maxLength: 6, example: "123456" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            accessToken: { type: "string", description: "JWT, expires in 1 hour" },
            refreshToken: { type: "string", description: "JWT, expires in 30 days" },
            userId: { type: "string" },
            privacyAccepted: { type: "boolean", description: "Whether the user has accepted the privacy notice" },
          },
        },
        401: S.Error,
        429: S.Error,
      },
    },
  }, handleVerifyOtp);

  app.post("/auth/refresh", {
    schema: {
      tags: ["Auth"],
      summary: "Refresh access token",
      body: {
        type: "object",
        required: ["refreshToken"],
        properties: { refreshToken: { type: "string" } },
      },
      response: {
        200: { type: "object", properties: { accessToken: { type: "string", description: "JWT, expires in 1 hour" } } },
        401: S.Error,
      },
    },
  }, handleRefreshToken);

  app.post("/auth/logout", {
    onRequest: [authenticate],
    schema: {
      tags: ["Auth"],
      summary: "Logout and revoke refresh token",
      security: [{ BearerAuth: [] }],
      body: {
        type: "object",
        required: ["refreshToken"],
        properties: { refreshToken: { type: "string" } },
      },
      response: {
        200: { type: "object", properties: { success: { type: "boolean" } } },
        401: S.Error,
      },
    },
  }, handleLogout);

  // ── Messages ─────────────────────────────────────────────────────────────────

  app.get<{ Querystring: { before?: string; limit?: string } }>("/messages", {
    onRequest: [authenticate],
    schema: {
      tags: ["Messages"],
      summary: "Get message history",
      description: "Returns paginated chat history (user + assistant messages) across all channels, newest first.",
      security: [{ BearerAuth: [] }],
      querystring: {
        type: "object",
        properties: {
          before: { type: "string", format: "date-time", description: "Cursor — return messages older than this ISO timestamp" },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            messages: { type: "array", items: S.MessageItem },
            hasMore: { type: "boolean" },
          },
        },
        401: S.Error,
      },
    },
  }, handleGetMessages);

  app.post("/messages/send", {
    onRequest: [authenticate],
    schema: {
      tags: ["Messages"],
      summary: "Send a message and get AI reply",
      description: "Stores the user message, runs the AI reply pipeline synchronously, and returns both messages. Times out after 30 seconds. Rate limited to 20 requests per minute.",
      security: [{ BearerAuth: [] }],
      body: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", minLength: 1, maxLength: 10000 },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            userMessage: S.MessageItem,
            assistantMessage: S.MessageItem,
          },
        },
        401: S.Error,
        429: S.Error,
        503: S.Error,
      },
    },
  }, handleSendMessage);

  // ── Insights ──────────────────────────────────────────────────────────────────

  app.post("/insights/generate", {
    onRequest: [authenticate],
    schema: {
      tags: ["Insights"],
      summary: "Request an insight",
      description: "Enqueues an insight generation job. Returns an insightId to poll. Only one insight per user can be in progress at a time.",
      security: [{ BearerAuth: [] }],
      body: {
        type: "object",
        required: ["type", "range"],
        properties: {
          type: { type: "string", enum: ["sessionbridge", "myself_lately"] },
          range: { type: "string", enum: ["last_7_days", "last_15_days", "last_30_days"] },
        },
      },
      response: {
        202: { type: "object", properties: { insightId: { type: "string" }, status: { type: "string" } } },
        401: S.Error,
        409: S.Error,
      },
    },
  }, handleGenerateInsight);

  app.get<{ Params: { insightId: string } }>("/insights/:insightId", {
    onRequest: [authenticate],
    schema: {
      tags: ["Insights"],
      summary: "Get insight status",
      description: "Poll this after POST /insights/generate. Status progresses queued → processing → success | success_fallback | failed.",
      security: [{ BearerAuth: [] }],
      params: {
        type: "object",
        required: ["insightId"],
        properties: { insightId: { type: "string" } },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["queued", "processing", "success", "success_fallback", "failed"] },
            insightType: { type: "string" },
            rangeStart: { type: "string", format: "date-time" },
            rangeEnd: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        401: S.Error,
        404: S.Error,
      },
    },
  }, handleGetInsight);

  app.get<{ Params: { insightId: string } }>("/insights/:insightId/pdf", {
    onRequest: [authenticate],
    schema: {
      tags: ["Insights"],
      summary: "Download insight PDF",
      description: "Returns the PDF bytes for a completed insight. Only available once status is success or success_fallback.",
      security: [{ BearerAuth: [] }],
      params: {
        type: "object",
        required: ["insightId"],
        properties: { insightId: { type: "string" } },
      },
      response: {
        200: { type: "string", format: "binary", description: "PDF file" },
        401: S.Error,
        404: S.Error,
      },
    },
  }, handleGetInsightPdf);

  // ── Checkin ───────────────────────────────────────────────────────────────────

  app.get("/checkin", {
    onRequest: [authenticate],
    schema: {
      tags: ["Checkin"],
      summary: "Get current check-in reminder",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            active: { type: "boolean" },
            time: { type: "string", enum: ["06:00", "16:00", "21:00"], nullable: true },
            label: { type: "string", nullable: true },
          },
        },
        401: S.Error,
      },
    },
  }, handleGetCheckin);

  app.post("/checkin/setup", {
    onRequest: [authenticate],
    schema: {
      tags: ["Checkin"],
      summary: "Set or turn off daily check-in reminder",
      security: [{ BearerAuth: [] }],
      body: {
        type: "object",
        required: ["time"],
        properties: {
          time: { type: "string", enum: ["06:00", "16:00", "21:00", "off"], description: "Time slot in HH:MM (Asia/Kolkata) or \"off\" to disable" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            active: { type: "boolean" },
            time: { type: "string", nullable: true },
            label: { type: "string", nullable: true },
          },
        },
        400: S.Error,
        401: S.Error,
      },
    },
  }, handleSetupCheckin);

  // ── Account ───────────────────────────────────────────────────────────────────

  app.get("/stats", {
    onRequest: [authenticate],
    schema: {
      tags: ["Account"],
      summary: "Get user stats",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            messageCount: { type: "integer" },
            memberSince: { type: "string", format: "date-time", nullable: true },
            lastInsight: {
              nullable: true,
              type: "object",
              properties: {
                type: { type: "string" },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
        401: S.Error,
      },
    },
  }, handleGetStats);

  app.delete("/account/data", {
    onRequest: [authenticate],
    schema: {
      tags: ["Account"],
      summary: "Delete my messages",
      description: "Permanently deletes the authenticated user's chat messages. Generated insights are retained (so any professional-support engagements/shares stay valid). Cannot be undone.",
      security: [{ BearerAuth: [] }],
      response: {
        200: { type: "object", properties: { success: { type: "boolean" } } },
        401: S.Error,
      },
    },
  }, handleDeleteAccountData);

  app.get("/privacy", {
    onRequest: [authenticate],
    schema: {
      tags: ["Account"],
      summary: "Get privacy notice",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: {
            message: { type: "string" },
            link: { type: "string", nullable: true },
            privacyAccepted: { type: "boolean", description: "True if user accepted the current policy version" },
          },
        },
        401: S.Error,
      },
    },
  }, handleGetPrivacy);

  app.post("/privacy/accept", {
    onRequest: [authenticate],
    schema: {
      tags: ["Account"],
      summary: "Accept privacy notice",
      description: "Records the user's consent. Sets privacyAcceptedAt and privacyAcceptedVersion on the user record. Safe to call multiple times.",
      security: [{ BearerAuth: [] }],
      response: {
        200: { type: "object", properties: { success: { type: "boolean" } } },
        401: S.Error,
      },
    },
  }, handleAcceptPrivacy);

  // ── Professional ──────────────────────────────────────────────────────────────

  app.post("/professional/profiles", {
    onRequest: [authenticate],
    schema: {
      tags: ["Professional"],
      summary: "Create a professional profile",
      description: "Self-serve onboarding. Creates a ProfessionalProfile for the caller and marks them a professional. A user may hold several profiles (e.g. therapist and coach). Active immediately; verificationStatus starts 'pending'.",
      security: [{ BearerAuth: [] }],
      body: {
        type: "object",
        required: ["professionalType", "displayName"],
        properties: {
          professionalType: { type: "string", enum: ["therapist", "counsellor", "coach"] },
          displayName: { type: "string", minLength: 1, maxLength: 120 },
          additionalTitle: { type: "string", maxLength: 120 },
        },
      },
      response: {
        201: S.ProfessionalProfile,
        400: S.Error,
        401: S.Error,
      },
    },
  }, handleCreateProfessionalProfile);

  app.get("/professional/profiles", {
    onRequest: [authenticate],
    schema: {
      tags: ["Professional"],
      summary: "List the caller's professional profiles",
      description: "Returns the authenticated user's own professional profiles (empty array if none).",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: { profiles: { type: "array", items: S.ProfessionalProfile } },
        },
        401: S.Error,
      },
    },
  }, handleListProfessionalProfiles);

  app.post("/professional/engagements", {
    onRequest: [authenticate, requireProfessional],
    schema: {
      tags: ["Professional"],
      summary: "Open an engagement with a client",
      description: "Pro-initiated. Identifies the client by E.164 phone: if an account exists it is linked (add); otherwise a pending invite is stored keyed by phone (invite), reconciled when that phone signs up. Always starts 'pending' — the client must accept. Rejects a duplicate pending/active engagement for the same pro↔client pair.",
      security: [{ BearerAuth: [] }],
      body: {
        type: "object",
        required: ["professionalId", "clientPhone"],
        properties: {
          professionalId: { type: "string", description: "One of the caller's professional profiles" },
          clientPhone: { type: "string", description: "E.164, e.g. +919876543210" },
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
        },
      },
      response: {
        201: S.Engagement,
        400: S.Error,
        401: S.Error,
        403: S.Error,
        404: S.Error,
        409: S.Error,
      },
    },
  }, handleCreateEngagement);

  app.get("/professional/engagements", {
    onRequest: [authenticate, requireProfessional],
    schema: {
      tags: ["Professional"],
      summary: "List the caller's engagements",
      description: "All engagements across the caller's professional profiles, newest first. Linked client profile (phone, name) is included once an account is attached.",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: { engagements: { type: "array", items: S.Engagement } },
        },
        401: S.Error,
        403: S.Error,
      },
    },
  }, handleListProfessionalEngagements);

  app.post<{ Params: { engagementId: string } }>("/professional/engagements/:engagementId/end", {
    onRequest: [authenticate, requireProfessional],
    schema: {
      tags: ["Professional"],
      summary: "End an engagement (professional)",
      description: "Professional ends the engagement (D11). Status -> ended, endedBy=professional. The client's access-granting shares stop resolving immediately (derived). 409 if already ended.",
      security: [{ BearerAuth: [] }],
      params: { type: "object", required: ["engagementId"], properties: { engagementId: { type: "string" } } },
      response: { 200: S.Engagement, 401: S.Error, 403: S.Error, 404: S.Error, 409: S.Error },
    },
  }, handleEndEngagementByPro);

  // ── Engagement (client side) ───────────────────────────────────────────────────

  app.get("/engagements", {
    onRequest: [authenticate],
    schema: {
      tags: ["Engagement"],
      summary: "List my engagements (as a client)",
      description: "The caller's engagements with professionals — pending (to accept), active, and ended — newest first, each with the professional's profile.",
      security: [{ BearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: { engagements: { type: "array", items: S.ClientEngagement } },
        },
        401: S.Error,
      },
    },
  }, handleListClientEngagements);

  app.post<{ Params: { engagementId: string } }>("/engagements/:engagementId/accept", {
    onRequest: [authenticate],
    schema: {
      tags: ["Engagement"],
      summary: "Accept a pending engagement",
      description: "The client's consent gate (D5). Moves a pending engagement to active. No client data flows to the professional until this is done. 409 if the engagement is not pending or an active one with that professional already exists.",
      security: [{ BearerAuth: [] }],
      params: {
        type: "object",
        required: ["engagementId"],
        properties: { engagementId: { type: "string" } },
      },
      response: {
        200: S.ClientEngagement,
        401: S.Error,
        404: S.Error,
        409: S.Error,
      },
    },
  }, handleAcceptEngagement);

  app.post<{ Params: { engagementId: string } }>("/engagements/:engagementId/end", {
    onRequest: [authenticate],
    schema: {
      tags: ["Engagement"],
      summary: "End an engagement (client)",
      description: "Client ends the engagement (D11) — from pending (decline) or active. Status -> ended, endedBy=client. The professional loses access immediately (derived). 409 if already ended.",
      security: [{ BearerAuth: [] }],
      params: { type: "object", required: ["engagementId"], properties: { engagementId: { type: "string" } } },
      response: { 200: S.ClientEngagement, 401: S.Error, 404: S.Error, 409: S.Error },
    },
  }, handleEndEngagementByClient);

  app.post<{ Params: { engagementId: string } }>("/engagements/:engagementId/shares", {
    onRequest: [authenticate],
    schema: {
      tags: ["Engagement"],
      summary: "Share an insight with this engagement",
      description: "Client discloses one of their own insights (any type) to an active engagement. The professional can then read it; no raw journal, no pull. Re-sharing a previously-unshared insight reactivates it.",
      security: [{ BearerAuth: [] }],
      params: { type: "object", required: ["engagementId"], properties: { engagementId: { type: "string" } } },
      body: { type: "object", required: ["insightId"], properties: { insightId: { type: "string" } } },
      response: {
        201: { type: "object", properties: { id: { type: "string" }, engagementId: { type: "string" }, insightId: { type: "string" }, sharedAt: { type: "string", format: "date-time" }, revokedAt: { type: "string", format: "date-time", nullable: true }, autoSent: { type: "boolean" } } },
        400: S.Error, 401: S.Error, 404: S.Error, 409: S.Error,
      },
    },
  }, handleShareInsight);

  app.delete<{ Params: { engagementId: string; insightId: string } }>("/engagements/:engagementId/shares/:insightId", {
    onRequest: [authenticate],
    schema: {
      tags: ["Engagement"],
      summary: "Unshare an insight",
      description: "Client revokes a single shared insight (sets revokedAt); the engagement and other shares are untouched. Idempotent.",
      security: [{ BearerAuth: [] }],
      params: { type: "object", required: ["engagementId", "insightId"], properties: { engagementId: { type: "string" }, insightId: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" } } }, 401: S.Error, 404: S.Error },
    },
  }, handleUnshareInsight);

  app.put<{ Params: { engagementId: string } }>("/engagements/:engagementId/auto-send", {
    onRequest: [authenticate],
    schema: {
      tags: ["Engagement"],
      summary: "Toggle auto-send of SessionBridge insights",
      description: "When enabled, new SessionBridge insights the client generates are automatically shared with this engagement. Future insights only.",
      security: [{ BearerAuth: [] }],
      params: { type: "object", required: ["engagementId"], properties: { engagementId: { type: "string" } } },
      body: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } },
      response: { 200: { type: "object", properties: { engagementId: { type: "string" }, autoSendSessionBridge: { type: "boolean" } } }, 400: S.Error, 401: S.Error, 404: S.Error, 409: S.Error },
    },
  }, handleSetAutoSend);

  app.get<{ Params: { engagementId: string } }>("/professional/engagements/:engagementId/insights", {
    onRequest: [authenticate, requireProfessional],
    schema: {
      tags: ["Professional"],
      summary: "List insights shared on an engagement",
      description: "Insights the client has shared and not revoked, only while the engagement is active (access is derived — ending the engagement cuts access). Metadata only.",
      security: [{ BearerAuth: [] }],
      params: { type: "object", required: ["engagementId"], properties: { engagementId: { type: "string" } } },
      response: {
        200: { type: "object", properties: { insights: { type: "array", items: { type: "object", properties: { insightId: { type: "string" }, insightType: { type: "string" }, status: { type: "string" }, rangeStart: { type: "string", format: "date-time" }, rangeEnd: { type: "string", format: "date-time" }, createdAt: { type: "string", format: "date-time" }, sharedAt: { type: "string", format: "date-time" }, autoSent: { type: "boolean" } } } } } },
        401: S.Error, 403: S.Error, 404: S.Error,
      },
    },
  }, handleListSharedInsights);

  app.get<{ Params: { engagementId: string; insightId: string } }>("/professional/engagements/:engagementId/insights/:insightId/pdf", {
    onRequest: [authenticate, requireProfessional],
    schema: {
      tags: ["Professional"],
      summary: "Download a shared insight PDF",
      description: "PDF of a shared insight, gated by the same derived access (active engagement + non-revoked share).",
      security: [{ BearerAuth: [] }],
      params: { type: "object", required: ["engagementId", "insightId"], properties: { engagementId: { type: "string" }, insightId: { type: "string" } } },
      response: { 200: { type: "string", format: "binary", description: "PDF file" }, 401: S.Error, 403: S.Error, 404: S.Error },
    },
  }, handleGetSharedInsightPdf);
}
