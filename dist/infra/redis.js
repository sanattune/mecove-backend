"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
const ioredis_1 = __importDefault(require("ioredis"));
let connection = null;
/**
 * Returns a shared ioredis connection using REDIS_URL.
 * Fails fast if REDIS_URL is missing.
 */
function getRedis() {
    const url = process.env.REDIS_URL;
    if (!url || url === "") {
        throw new Error("REDIS_URL is required. Set it in .env");
    }
    if (!connection) {
        connection = new ioredis_1.default(url, { maxRetriesPerRequest: null });
    }
    return connection;
}
