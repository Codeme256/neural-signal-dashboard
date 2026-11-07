import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { NeuralCanvas } from "@/components/signal/NeuralCanvas";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — TradePulse" },
      { name: "description", content: "Choose a new password for your TradePulse account." },
      { property: "og:title", content: "Set a new password — TradePulse" },
      { property: "og:description", content: "Choose a new password for your TradePulse account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) setReady(true);
    const { data } = supabase.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") setReady(true); });
    supabase.auth.getSession().then(({ data: s }) => { if (s.session) setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <NeuralCanvas className="pointer-events-none fixed inset-0 h-full w-full opacity-60" />
      <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <section className="signal-panel rounded-2xl border border-primary/40 p-6">
          <h1 className="font-display text-2xl font-bold">Set a new password</h1>
          {!ready ? (
            <p className="mt-3 text-sm text-muted-foreground">Open this page from the reset link in your email. Links expire after a while — you can request a new one from the sign-in page.</p>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-3">
              <label className="block">
                <span className="mb-1 block font-mono text-[10px] tracking-widest text-muted-foreground">NEW PASSWORD</span>
                <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-border bg-card/60 px-4 py-2.5 font-mono text-sm outline-none focus:border-primary" />
              </label>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={busy} className="scan-btn w-full">{busy ? "SAVING…" : "SAVE PASSWORD"}</button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
