import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal .env loader. Reads `KEY=VALUE` lines (with `#` comments, blank lines,
 * and optional surrounding quotes) and copies them into `process.env`. Variables
 * already present in the environment WIN — so an inline `TERMINALHUB_TOKEN=… npm start`
 * still overrides the file. No dependency; behaves identically under tsx and node.
 */
export function loadDotenv(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let val = line.slice(eq + 1).trim();
    const quoted =
      (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"));
    if (quoted) val = val.slice(1, -1);
    process.env[key] = val;
  }
}
