import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { getToken, setToken } from "../api/client";

type State = "checking" | "open" | "locked";

// Probe an authed endpoint. On loopback the token is ignored so this passes and the app renders.
// On an exposed host without a valid token it 401s, so we show a featureless box instead of the app.
// A blank screen reveals nothing while the probe is in flight.
async function probeAuth(): Promise<State> {
  try {
    const t = getToken();
    const res = await fetch("/api/settings", { headers: t ? { authorization: `Bearer ${t}` } : {} });
    return res.status === 401 ? "locked" : "open";
  } catch {
    return "locked";
  }
}

export function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");

  useEffect(() => { let live = true; probeAuth().then((s) => { if (live) setState(s); }); return () => { live = false; }; }, []);

  if (state === "checking") return null;
  if (state === "open") return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input = (e.currentTarget as HTMLFormElement).elements.namedItem("k") as HTMLInputElement;
    const v = input.value.trim();
    input.value = "";
    if (!v) return;
    setToken(v);
    setState("checking");
    setState(await probeAuth()); // wrong value falls straight back to the box, no message
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-canvas">
      <form onSubmit={submit}>
        <input
          name="k"
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="w-56 rounded border border-edge-strong bg-canvas px-3 py-2 text-bright outline-none focus:border-blue-500"
        />
      </form>
    </div>
  );
}
