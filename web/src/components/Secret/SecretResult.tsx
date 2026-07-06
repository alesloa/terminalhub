import { useEffect, useState, type ReactNode } from "react";
import { burnSecret } from "./secretApi";
import { copyText } from "../../lib/clipboard";

export interface SecretResultData {
  id: string;
  oneClickUrl: string; // link with the key in the fragment — direct access
  shortUrl: string; // link without the key — pair with the decryption key below
  decryptionKey: string; // the key, for sharing alongside the short link
  burnToken?: string; // present only for creator-only links
}

/** Copy-to-clipboard button with a copy glyph and a transient ✓ confirmation. */
function CopyButton({ value, className = "" }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      onClick={async () => {
        // copyText never throws — falls back to execCommand on plain-http origins.
        // The value box stays selectable if even that is blocked.
        if (await copyText(value)) setCopied(true);
      }}
      className={`shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded border text-sm ${
        copied ? "border-green-600 text-green-400" : "border-edge bg-elevated text-fg hover:bg-edge"
      } ${className}`}
    >
      {copied ? <CheckGlyph /> : <CopyGlyph />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** One "title / description / [Copy] [value]" block, as in the reference result screen. */
function ShareRow({ title, desc, value }: { title: string; desc: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge bg-elevated/30 p-4">
      <div className="text-base font-semibold text-bright">{title}</div>
      <div className="mt-0.5 text-sm text-dim">{desc}</div>
      <div className="mt-3 flex items-start gap-3">
        <CopyButton value={value} />
        <div className="flex-1 min-w-0 rounded-lg border border-edge bg-canvas px-3 py-2 font-mono text-sm text-fg break-all">
          {value}
        </div>
      </div>
    </div>
  );
}

/**
 * Post-creation screen, mirroring the onetime/Yopass result: a one-click link (key embedded), a
 * short link plus its standalone decryption key for out-of-band sharing, an early-destroy (burn)
 * action, and a way to make another secret.
 */
export function SecretResult({ data, onReset }: { data: SecretResultData; onReset: () => void }) {
  const [burning, setBurning] = useState(false);
  const [burned, setBurned] = useState(false);
  const [burnErr, setBurnErr] = useState<string | null>(null);

  const burn = async () => {
    setBurning(true);
    setBurnErr(null);
    try {
      const ok = await burnSecret(data.id, data.burnToken);
      if (ok) setBurned(true);
      else setBurnErr("Could not destroy the link.");
    } catch (e) {
      setBurnErr(e instanceof Error ? e.message : "Could not destroy the link.");
    } finally {
      setBurning(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <CircleCheck />
        <h2 className="text-2xl font-bold text-bright">Secret stored securely</h2>
      </div>
      <p className="-mt-2 text-sm text-fg">
        Your secret has been encrypted and stored. Share these links to provide access.
      </p>

      <ShareRow title="One-click link" desc="Share this link for direct access to the secret" value={data.oneClickUrl} />
      <ShareRow title="Short link" desc="Requires the decryption key to be shared separately" value={data.shortUrl} />
      <ShareRow title="Decryption key" desc="Required to decrypt the message with the short link" value={data.decryptionKey} />

      <div className="rounded-lg border border-edge bg-elevated/30 p-4">
        <div className="text-base font-semibold text-bright">Destroy now</div>
        <div className="mt-0.5 text-sm text-dim">
          {data.burnToken
            ? "Only you, from this browser, can destroy it early — viewers cannot."
            : "Anyone with the link can destroy it early."}
        </div>
        <button
          onClick={burn}
          disabled={burning || burned}
          className={`mt-3 inline-flex items-center gap-1.5 px-3 h-9 rounded border text-sm font-medium ${
            burned
              ? "border-edge text-dim"
              : "border-red-600/60 text-red-400 hover:bg-red-600/10 disabled:opacity-50"
          }`}
        >
          {!burned && <TrashGlyph />}
          {burned ? "Destroyed" : burning ? "Destroying…" : "Destroy now"}
        </button>
        {burnErr && <div className="mt-2 text-xs text-red-400">{burnErr}</div>}
      </div>

      <div className="flex justify-center pt-1">
        <button
          onClick={onReset}
          className="px-5 h-11 inline-flex items-center rounded-lg bg-elevated hover:bg-edge text-sm font-medium text-fg"
        >
          Create another secret
        </button>
      </div>
    </div>
  );
}

function CircleCheck() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-green-500 shrink-0" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

function CopyGlyph(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckGlyph(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 6" />
    </svg>
  );
}

function TrashGlyph(): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}
