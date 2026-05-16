import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildApp } from "../api/server";
import { closeRedis } from "../infra/redis";
import { prisma } from "../infra/prisma";
import { replyBatchQueue } from "../queues/replyBatchQueue";
import { replyQueue } from "../queues/replyQueue";
import { reminderQueue } from "../queues/reminderQueue";
import { summaryQueue } from "../queues/summaryQueue";

type SwaggerExporter = {
  swagger: (options: { yaml: true }) => string;
};

async function main(): Promise<void> {
  const outputPath = resolve(process.cwd(), process.argv[2] ?? "docs/openapi.yaml");
  const app = await buildApp();

  try {
    await app.ready();
    const yaml = (app as unknown as SwaggerExporter).swagger({ yaml: true });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, yaml.endsWith("\n") ? yaml : `${yaml}\n`, "utf8");
    console.log(`OpenAPI YAML written to ${outputPath}`);
  } finally {
    await app.close();
    await Promise.allSettled([
      summaryQueue.close(),
      replyQueue.close(),
      replyBatchQueue.close(),
      reminderQueue.close(),
      prisma.$disconnect(),
      closeRedis(),
    ]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
