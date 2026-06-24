// ids look like ws_xxxx / tm_xxxx (alphanumeric). Session: tr_<wsId>_<tmId>
export function sessionName(workspaceId: string, terminalId: string): string {
  return `tr_${workspaceId}_${terminalId}`;
}
export function isTerminalHubSession(name: string): boolean {
  return /^tr_ws_[a-z0-9]+_tm_[a-z0-9]+$/i.test(name);
}
export function parseSession(name: string): { workspaceId: string; terminalId: string } | null {
  const m = name.match(/^tr_(ws_[a-z0-9]+)_(tm_[a-z0-9]+)$/i);
  return m ? { workspaceId: m[1], terminalId: m[2] } : null;
}
