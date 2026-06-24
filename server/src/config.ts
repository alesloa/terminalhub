import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8189),
  HOST: z.string().default("127.0.0.1"),
  FS_ROOTS: z.string().optional(), // comma-separated allowlist when exposed
});

export type GoogleConfig = { clientId: string; clientSecret: string; redirect: string | null };

export type Config = {
  port: number; host: string; token: string | null; dbPath: string; fsRoots: string[] | null;
  reveal: string | null; onetimeBase: string | null; google: GoogleConfig | null;
};

// All env vars use the TERMINALHUB_ prefix.
function envVar(env: Record<string, string | undefined>, name: string): string | undefined {
  return env[`TERMINALHUB_${name}`];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const p = schema.parse(env);
  const token = envVar(env, "TOKEN") ?? null;
  const dbPath = envVar(env, "DB") ?? "data/terminalhub.db";
  const reveal = envVar(env, "REVEAL") ?? null;
  const onetimeBase = env.ONETIME_BASE?.trim() ? env.ONETIME_BASE.trim().replace(/\/$/, "") : null;

  // Google Drive OAuth creds (server-only). Both id+secret must be present for the feature to turn
  // on; when either is missing, `google` is null and every /api/drive/* route returns "not configured".
  const gid = env.GOOGLE_CLIENT_ID?.trim();
  const gsec = env.GOOGLE_CLIENT_SECRET?.trim();
  const google: GoogleConfig | null = gid && gsec
    ? { clientId: gid, clientSecret: gsec, redirect: env.GOOGLE_OAUTH_REDIRECT?.trim() || null }
    : null;

  const exposed = p.HOST !== "127.0.0.1" && p.HOST !== "localhost" && p.HOST !== "::1";
  if (exposed && !token) {
    throw new Error("Refusing to bind to a non-loopback HOST without TERMINALHUB_TOKEN set. Set a token to expose Terminal Hub.");
  }
  return {
    port: p.PORT, host: p.HOST, token, dbPath,
    fsRoots: p.FS_ROOTS ? p.FS_ROOTS.split(",").map(s => s.trim()) : null,
    reveal, onetimeBase, google,
  };
}
