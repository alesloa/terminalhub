import type { CopilotSkillAccount } from "../../../types.js";

// Pick which mailbox a request targets from natural-language hints the model passes. Priority:
// explicit account (id or label), then provider; a single configured account wins by default; an
// ambiguous request returns an error string so the tool can ask the user to disambiguate.
export function resolveAccount(
  accounts: CopilotSkillAccount[],
  opts: { account?: string; provider?: string },
): CopilotSkillAccount | { error: string } {
  if (!accounts.length) return { error: "No email accounts are connected. Add one in Copilot → Skills → Email." };

  if (opts.account) {
    const m = accounts.find((a) => a.id === opts.account || a.label.toLowerCase() === opts.account!.toLowerCase());
    if (m) return m;
  }
  if (opts.provider) {
    const p = opts.provider.toLowerCase();
    const matches = accounts.filter((a) => a.provider === p);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return { error: `You have several ${opts.provider} accounts — which one: ${matches.map((a) => a.label).join(", ")}?` };
    // provider given but none match — fall through to the generic prompt below
  }
  if (accounts.length === 1) return accounts[0];
  return { error: `Which account? You have: ${accounts.map((a) => `${a.label} (${a.provider})`).join(", ")}.` };
}
