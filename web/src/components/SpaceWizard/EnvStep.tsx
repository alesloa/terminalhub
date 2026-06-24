/** Wizard step: paste a raw .env. Plaintext by design (personal single-user instance) — the UI is
 *  explicit about what happens so it's an informed choice, not a surprise. */
export function EnvStep({ env, onChange }: { env: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <p className="text-sm text-muted">
        Paste a <code className="text-fg">.env</code> (one <code className="text-fg">KEY=value</code> per line). It's
        written to each workspace's <code className="text-fg">.env</code>, auto-added to{" "}
        <code className="text-fg">.gitignore</code>, and only the variable <strong>names</strong> are surfaced to the
        agent's rules file — never the values.
      </p>
      <textarea value={env} onChange={(e) => onChange(e.target.value)} spellCheck={false}
        placeholder={"OPENAI_API_KEY=sk-…\nDATABASE_URL=postgres://…"}
        className="flex-1 min-h-0 w-full px-3 py-2 bg-[#1c1c1c] border border-edge rounded font-mono text-xs leading-relaxed outline-none focus:border-accent resize-none" />
      <p className="text-xs text-dim">
        Stored in plaintext on this server. A hand-authored <code className="text-fg">.env</code> in a workspace is never
        overwritten.
      </p>
    </div>
  );
}
