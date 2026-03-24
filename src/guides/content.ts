import { readFileSync } from "node:fs";
import { join } from "node:path";

const USER_GUIDE = readFileSync(join(__dirname, "user_guide.md"), "utf8");
const ADMIN_GUIDE = readFileSync(join(__dirname, "admin_guide.md"), "utf8");

export function getUserGuide(): string {
  return USER_GUIDE;
}

export function getFullGuide(isAdmin: boolean): string {
  return isAdmin ? `${USER_GUIDE}\n\n---\n\n${ADMIN_GUIDE}` : USER_GUIDE;
}
