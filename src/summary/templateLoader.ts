import fs from "node:fs";
import path from "node:path";
import { logger } from "../infra/logger";

const TEMPLATE_DIR = path.join(__dirname, "template");

function checkTemplatePath(filePath: string, name: string): void {
  if (!fs.existsSync(filePath)) {
    logger.error(`Template file not found: ${name}`, {
      path: filePath,
      __dirname,
      templateDir: TEMPLATE_DIR,
      cwd: process.cwd(),
    });
    throw new Error(`Template file not found: ${name} at ${filePath}`);
  }
}

export function loadReportHtml(): string {
  const p = path.join(TEMPLATE_DIR, "sessionbridge-report.html");
  checkTemplatePath(p, "sessionbridge-report.html");
  return fs.readFileSync(p, "utf8");
}

export function loadReportCss(): string {
  const p = path.join(TEMPLATE_DIR, "styles.css");
  checkTemplatePath(p, "styles.css");
  return fs.readFileSync(p, "utf8");
}

/**
 * Load an image from template/images/ as base64 data URL for embedding in HTML.
 * Use when rendering HTML as string (e.g. for PDF) so paths resolve.
 */
export function loadImageAsDataUrl(filename: string): string {
  const p = path.join(TEMPLATE_DIR, "images", filename);
  const buf = fs.readFileSync(p);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
