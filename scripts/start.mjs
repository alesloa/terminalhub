// Cross-platform `npm start`. Windows shells (cmd/PowerShell) don't parse the POSIX
// `PORT=5173 node ...` prefix, so set the port here and boot the built server by importing
// it — server/dist/index.js boots at top level (no main-guard). An externally-set PORT wins.
process.env.PORT = process.env.PORT ?? "5173";
await import("../server/dist/index.js");
