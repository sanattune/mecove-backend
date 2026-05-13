import http from "node:http";

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

export type AuthenticatedRequest = http.IncomingMessage & {
  userId: string;
  requestId: string;
};
