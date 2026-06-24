import { useState, type ReactNode } from "react";
import {
  postSecret,
  randomKey,
  shareUrl,
  type OnetimeConfig,
} from "./secretApi";
import type { SecretResultData } from "./SecretResult";

const HOUR = 3600;
const DAY = 86400;
const PRESETS = [
  { value: HOUR, label: "One Hour" },
  { value: DAY, label: "One Day" },
  { value: 7 * DAY, label: "One Week" },
];

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

/** A pill toggle switch styled off the brand tokens (accent when on). */
function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${on ? "bg-accent" : "bg-edge"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

/** A segmented option button (expiry presets, burn-authority choice). */
function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 px-3 rounded-lg border text-sm font-medium transition ${
        active
          ? "border-accent bg-accent/15 text-bright"
          : "border-edge bg-elevated text-fg hover:bg-edge hover:border-edge-strong"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The create form, modeled on the onetime/Yopass CreateSecret screen: secret body, auto-delete
 * expiry (presets or a server-bounded custom value), an optional view limit (1 = one-time),
 * an optional self-supplied decryption key, and who may burn the link early. On submit it
 * encrypts in-browser, POSTs the ciphertext, and hands the resulting link up via `onCreated`.
 */
export function SecretForm({
  config,
  onCreated,
}: {
  config: OnetimeConfig;
  onCreated: (data: SecretResultData) => void;
}) {
  const customExpiryAvailable = !!config.MAX_EXPIRATION && !!config.MIN_EXPIRATION;
  const maxViews = config.MAX_VIEWS ?? 0;
  const viewLimitAvailable = maxViews > 1 && !config.FORCE_ONETIME_SECRETS;
  const minExpiry = config.MIN_EXPIRATION ?? HOUR;
  const maxExpiry = config.MAX_EXPIRATION ?? 7 * DAY;

  const [secret, setSecret] = useState("");
  // Expiry: a preset value, or a custom value+unit clamped to the server bounds.
  const initialPreset = PRESETS.some((p) => p.value === config.DEFAULT_EXPIRY) ? config.DEFAULT_EXPIRY : HOUR;
  const [expiryMode, setExpiryMode] = useState<"preset" | "custom">("preset");
  const [preset, setPreset] = useState(initialPreset);
  const [customValue, setCustomValue] = useState(1);
  const [customUnit, setCustomUnit] = useState<"hours" | "days">("days");

  // View limit. Enabled by default at 1 view = one-time (the secure, common case), matching the
  // reference. The number IS the limit: 1 → one_time, N≥2 → multi-view.
  const [limitEnabled, setLimitEnabled] = useState(true);
  const [viewCount, setViewCount] = useState(1);

  const [generateKey, setGenerateKey] = useState(true);
  const [customPassword, setCustomPassword] = useState("");
  const [creatorBurnOnly, setCreatorBurnOnly] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitSeconds = customUnit === "days" ? DAY : HOUR;
  const maxUnitValue = Math.max(1, Math.floor(maxExpiry / unitSeconds));
  const minUnitValue = Math.max(1, Math.floor(minExpiry / unitSeconds));
  const expiration =
    expiryMode === "custom" && customExpiryAvailable
      ? clamp(customValue * unitSeconds, minExpiry, maxExpiry)
      : preset;

  const setViews = (next: number) => {
    const c = clamp(next, 1, maxViews);
    setViewCount(c);
  };

  const submit = async () => {
    if (!secret.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const password = !generateKey && customPassword.trim() ? customPassword.trim() : randomKey();
      const useViewLimit = viewLimitAvailable && limitEnabled && viewCount >= 2;
      const oneTime = config.FORCE_ONETIME_SECRETS || (limitEnabled && viewCount <= 1);
      const { id, burnToken } = await postSecret({
        message: secret,
        key: password,
        expiration,
        one_time: oneTime,
        creator_burn_only: creatorBurnOnly,
        ...(useViewLimit ? { views: viewCount } : {}),
      });
      onCreated({
        id,
        oneClickUrl: shareUrl(config.PUBLIC_URL, id, password),
        shortUrl: shareUrl(config.PUBLIC_URL, id),
        decryptionKey: password,
        burnToken,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Secret body */}
      <div>
        <label htmlFor="tr-secret" className="block text-sm font-medium text-fg mb-1.5">
          Your Secret
        </label>
        <textarea
          id="tr-secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Enter your secret…"
          rows={4}
          spellCheck={false}
          className="w-full min-h-[120px] resize-y rounded-lg border border-edge bg-canvas p-3 text-sm text-fg outline-none focus:border-accent"
        />
      </div>

      {/* Expiry */}
      <div>
        <div className="text-sm font-semibold text-bright mb-2">Deleted automatically after</div>
        <div className={`grid gap-2 ${customExpiryAvailable ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
          {PRESETS.map((p) => (
            <Segment
              key={p.value}
              active={expiryMode === "preset" && preset === p.value}
              onClick={() => {
                setExpiryMode("preset");
                setPreset(p.value);
              }}
            >
              {p.label}
            </Segment>
          ))}
          {customExpiryAvailable && (
            <Segment active={expiryMode === "custom"} onClick={() => setExpiryMode("custom")}>
              Custom
            </Segment>
          )}
        </div>
        {customExpiryAvailable && expiryMode === "custom" && (
          <div className="mt-3 flex items-end gap-3">
            <input
              type="number"
              min={minUnitValue}
              max={maxUnitValue}
              value={customValue}
              onChange={(e) => setCustomValue(clamp(parseInt(e.target.value) || minUnitValue, minUnitValue, maxUnitValue))}
              className="w-24 h-9 rounded border border-edge bg-canvas px-2 text-sm text-fg outline-none focus:border-accent"
            />
            <select
              value={customUnit}
              onChange={(e) => {
                const unit = e.target.value as "hours" | "days";
                setCustomUnit(unit);
                const nextMax = Math.max(1, Math.floor(maxExpiry / (unit === "days" ? DAY : HOUR)));
                setCustomValue((v) => clamp(v, 1, nextMax));
              }}
              className="h-9 rounded border border-edge bg-canvas px-2 text-sm text-fg outline-none focus:border-accent"
            >
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
            <span className="pb-2 text-xs text-dim">
              {minUnitValue}–{maxUnitValue} {customUnit}
            </span>
          </div>
        )}
      </div>

      {/* Options card */}
      <div className="rounded-lg border border-edge bg-elevated/40 divide-y divide-edge">
        {/* Fallback when the instance doesn't expose a view limit: a plain one-time switch so the
            user can still choose between burn-after-reading and an expiry-only link. */}
        {!viewLimitAvailable && !config.FORCE_ONETIME_SECRETS && (
          <div className="p-3">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-sm font-medium text-fg">Burn after first open</span>
              <Switch
                on={limitEnabled}
                onChange={(on) => {
                  setLimitEnabled(on);
                  setViewCount(1);
                }}
              />
            </label>
          </div>
        )}
        {viewLimitAvailable && (
          <div className="p-3">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <span className="text-sm font-medium text-fg">Limit number of views</span>
              <Switch
                on={limitEnabled}
                onChange={(on) => {
                  setLimitEnabled(on);
                  if (on) setViewCount(1);
                }}
              />
            </label>
            {limitEnabled && (
              <div className="mt-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-dim">Maximum views</span>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setViews(viewCount - 1)}
                      disabled={viewCount <= 1}
                      className="w-8 h-8 rounded-l border border-edge bg-elevated text-fg disabled:opacity-40 hover:bg-edge"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={maxViews}
                      value={viewCount}
                      onChange={(e) => setViews(parseInt(e.target.value) || 1)}
                      className="w-14 h-8 border-y border-edge bg-canvas text-center text-sm text-fg outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setViews(viewCount + 1)}
                      disabled={viewCount >= maxViews}
                      className="w-8 h-8 rounded-r border border-edge bg-elevated text-fg disabled:opacity-40 hover:bg-edge"
                    >
                      +
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-dim">
                  {viewCount <= 1
                    ? "Self-destructs after the first open — only one person can read it."
                    : `Destroyed after it has been opened ${viewCount} times.`}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="p-3">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm font-medium text-fg">Generate decryption key</span>
            <Switch on={generateKey} onChange={setGenerateKey} />
          </label>
          {!generateKey && (
            <div className="mt-3">
              <input
                type="password"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                placeholder="Your own decryption key (optional)"
                className="w-full h-9 rounded border border-edge bg-canvas px-3 text-sm text-fg outline-none focus:border-accent"
              />
              <p className="mt-1.5 text-xs text-dim">
                Leave blank to auto-generate. A key you set is shared separately from the link.
              </p>
            </div>
          )}
        </div>

        <div className="p-3">
          <div className="text-sm font-medium text-fg mb-2">Who can destroy this link early?</div>
          <div className="grid grid-cols-2 gap-2">
            <Segment active={creatorBurnOnly} onClick={() => setCreatorBurnOnly(true)}>
              Only me
            </Segment>
            <Segment active={!creatorBurnOnly} onClick={() => setCreatorBurnOnly(false)}>
              Anyone with the link
            </Segment>
          </div>
          <p className="mt-2 text-xs text-dim">
            “Only me” keeps a destroy key in this browser; “Anyone with the link” lets any holder destroy it.
          </p>
        </div>
      </div>

      <button
        onClick={submit}
        disabled={!secret.trim() || submitting}
        className="h-12 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold inline-flex items-center justify-center gap-2"
      >
        <LockIcon />
        {submitting ? "Encrypting…" : "Encrypt Message"}
      </button>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
