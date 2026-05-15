import path from "node:path";
import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "meCove API",
      version: "0.1.0",
      description: "REST API for the meCove mobile app. Base path: `/api/v1`.",
    },
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Access token returned by `/auth/verify` or `/auth/refresh`. Expires in 1 hour.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "VALIDATION_ERROR" },
                message: { type: "string", example: "Invalid request" },
              },
            },
          },
        },
        MessageItem: {
          type: "object",
          properties: {
            id: { type: "string", example: "clx1abc:user" },
            role: { type: "string", enum: ["user", "assistant"] },
            content: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
  apis: [path.join(process.cwd(), "src/api/rest/handlers/*.ts")],
};

export function getOpenapiSpec(): object {
  return swaggerJsdoc(options);
}
