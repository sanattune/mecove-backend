"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const url = process.env.DATABASE_URL;
if (!url || url === "") {
    throw new Error("DATABASE_URL is required. Set it in .env");
}
const adapter = new adapter_pg_1.PrismaPg({ connectionString: url });
exports.prisma = new client_1.PrismaClient({ adapter });
