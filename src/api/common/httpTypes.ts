import http from "node:http";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

// Legacy types — still used by WhatsApp webhook handler
export type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

export type AuthenticatedRequest = http.IncomingMessage & {
  userId: string;
  requestId: string;
};
