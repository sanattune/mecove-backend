import type { FastifyInstance } from "fastify";
import { authenticate } from "./middleware/auth";
import { handleRequestOtp, handleVerifyOtp, handleRefreshToken, handleLogout } from "./handlers/authHandler";
import { handleGetMessages, handleSendMessage } from "./handlers/messageHandler";
import { handleGenerateSummary, handleGetSummary, handleGetSummaryPdf } from "./handlers/summaryHandler";
import { handleGetCheckin, handleSetupCheckin } from "./handlers/checkinHandler";
import { handleGetStats, handleDeleteAccountData, handleGetPrivacy } from "./handlers/accountHandler";

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
} as const;

export async function restPlugin(app: FastifyInstance): Promise<void> {
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

  // ── Summary ───────────────────────────────────────────────────────────────────

  app.post("/summary/generate", {
    onRequest: [authenticate],
    schema: {
      tags: ["Summary"],
      summary: "Request a report",
      description: "Enqueues a report generation job. Returns a summaryId to poll. Only one report per user can be in progress at a time.",
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
        202: { type: "object", properties: { summaryId: { type: "string" }, status: { type: "string" } } },
        401: S.Error,
        409: S.Error,
      },
    },
  }, handleGenerateSummary);

  app.get<{ Params: { summaryId: string } }>("/summary/:summaryId", {
    onRequest: [authenticate],
    schema: {
      tags: ["Summary"],
      summary: "Get report status",
      description: "Poll this after POST /summary/generate. Status progresses queued → processing → success | success_fallback | failed.",
      security: [{ BearerAuth: [] }],
      params: {
        type: "object",
        required: ["summaryId"],
        properties: { summaryId: { type: "string" } },
      },
      response: {
        200: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["queued", "processing", "success", "success_fallback", "failed"] },
            reportType: { type: "string" },
            rangeStart: { type: "string", format: "date-time" },
            rangeEnd: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        401: S.Error,
        404: S.Error,
      },
    },
  }, handleGetSummary);

  app.get<{ Params: { summaryId: string } }>("/summary/:summaryId/pdf", {
    onRequest: [authenticate],
    schema: {
      tags: ["Summary"],
      summary: "Download report PDF",
      description: "Returns the PDF bytes for a completed report. Only available once status is success or success_fallback.",
      security: [{ BearerAuth: [] }],
      params: {
        type: "object",
        required: ["summaryId"],
        properties: { summaryId: { type: "string" } },
      },
      response: {
        200: { type: "string", format: "binary", description: "PDF file" },
        401: S.Error,
        404: S.Error,
      },
    },
  }, handleGetSummaryPdf);

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
            lastReport: {
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
      summary: "Delete all user data",
      description: "Permanently deletes all messages and reports for the authenticated user. Cannot be undone.",
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
          },
        },
        401: S.Error,
      },
    },
  }, handleGetPrivacy);
}
