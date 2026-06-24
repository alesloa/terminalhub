import { OAuth2Client } from "google-auth-library";
import type { GoogleConfig } from "../config.js";

// Full Drive scope (shared drives + write, for later phases) plus identity for the account label.
export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "openid", "email", "profile",
];

// OAuth 2.0 Authorization-Code flow with offline access. google-auth-library owns token exchange and
// refresh; the consent URL itself is pure string-building. The client_secret + refresh tokens stay
// server-side and never reach the browser.
export function createOAuth(google: GoogleConfig) {
  const client = (redirect: string) => new OAuth2Client(google.clientId, google.clientSecret, redirect);
  const redirectFor = (origin: string) => google.redirect ?? `${origin}/api/drive/callback`;

  return {
    redirectFor,
    consentUrl(state: string, origin = "") {
      return client(redirectFor(origin)).generateAuthUrl({
        // `select_account` forces the chooser so a SECOND/third Google account can be connected
        // (without it Google silently reuses the active session); `consent` guarantees a refresh token.
        access_type: "offline", prompt: "select_account consent", scope: DRIVE_SCOPES, state,
      });
    },
    // Exchange the callback code for tokens + the signed-in email.
    async exchange(code: string, origin: string) {
      const c = client(redirectFor(origin));
      const { tokens } = await c.getToken(code);
      c.setCredentials(tokens);
      const info = await c.getTokenInfo(tokens.access_token!);   // { email, ... }
      return {
        email: info.email!, refreshToken: tokens.refresh_token ?? null,
        accessToken: tokens.access_token!, expiry: tokens.expiry_date ?? null,
        scope: tokens.scope ?? DRIVE_SCOPES.join(" "),
      };
    },
    // Mint a fresh access token from a stored refresh token.
    async refresh(refreshToken: string) {
      const c = client(redirectFor(""));
      c.setCredentials({ refresh_token: refreshToken });
      const { token } = await c.getAccessToken();           // triggers refresh
      const creds = c.credentials;
      return { accessToken: token!, expiry: creds.expiry_date ?? Date.now() + 3_500_000 };
    },
  };
}
export type OAuth = ReturnType<typeof createOAuth>;
