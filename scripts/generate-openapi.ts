import fs from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { getOpenapiSpec } from "../src/api/openapi";

const spec = getOpenapiSpec();
const outPath = path.join(process.cwd(), "openapi.yaml");
fs.writeFileSync(outPath, stringify(spec, { lineWidth: 120 }), "utf8");
console.log(`openapi.yaml written to ${outPath}`);
