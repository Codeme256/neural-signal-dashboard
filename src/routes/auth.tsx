import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { NeuralCanvas } from "@/components/signal/NeuralCanvas";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Sign in — TradePulse Neural Signal Engine" },
      { name: "description", content: "Sign in or create a TradePulse account with email or Google to scan markets and track your signals." },
      { property: "og:title", content: "Sign in — TradePulse Neural Signal Engine" },
      { property: "og:description", content: "Create your TradePulse account to scan markets and track signal results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: Mode) => { setMode(m); setError(null); setNotice(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/", replace: true });
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin, data: { display_name: name.trim() } },
        });
        if (error) throw error;
        if (data.session) { toast.success("Account created"); navigate({ to: "/", replace: true }); }
        else { setNotice(`We sent a confirmation link to ${email}. Open it to activate your account, then sign in.`); toast.success("Check your email to confirm your account"); }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setNotice(`If an account exists for ${email}, a password reset link is on its way.`);
        toast.success("Password reset requested");
      }
    } catch (err) {
      setError(friendly(err));
      toast.error(friendly(err));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true); setError(null);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) { setError("Google sign-in didn't finish. Please try again."); toast.error("Google sign-in failed"); setBusy(false); return; }
    if (result.redirected) return;
    navigate({ to: "/", replace: true });
  };

  const title = mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset password";

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <NeuralCanvas className="pointer-events-none fixed inset-0 h-full w-full opacity-60" />
      <div className="hero-glow pointer-events-none fixed inset-0" />
      <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <div className="mb-8 flex items-center justify-center gap-3">
          <img src="/tradepulse-mark.svg" alt="" className="h-12 w-12" />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">TRADE<span className="text-primary">PULSE</span></h1>
            <p className="font-mono text-xs text-muted-foreground">NEURAL SIGNAL ENGINE</p>
          </div>
        </div>

        <section className="signal-panel rounded-2xl border border-primary/40 p-6">
          {mode !== "forgot" && (
            <div className="mb-5 grid grid-cols-2 gap-2" role="tablist">
              <button role="tab" aria-selected={mode === "signin"} onClick={() => switchMode("signin")} className={`chip ${mode === "signin" ? "chip-active" : ""}`}>SIGN IN</button>
              <button role="tab" aria-selected={mode === "signup"} onClick={() => switchMode("signup")} className={`chip ${mode === "signup" ? "chip-active" : ""}`}>SIGN UP</button>
            </div>
          )}
          <h2 className="font-display text-2xl font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot" ? "Enter your email and we'll send you a reset link." : "Sign in to scan markets and track your signals."}
          </p>

          {mode !== "forgot" && (
            <>
              <div className="mt-5"><GoogleButton onClick={google} disabled={busy} /></div>
              <div className="my-5 flex items-center gap-3 font-mono text-[10px] tracking-widest text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> OR WITH EMAIL <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form onSubmit={submit} className={`space-y-3 ${mode === "forgot" ? "mt-5" : ""}`}>
            {mode === "signup" && (
              <Field label="Your name" type="text" value={name} onChange={setName} autoComplete="name" required maxLength={40} />
            )}
            <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
            {mode !== "forgot" && (
              <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : undefined} />
            )}
            {mode === "signup" && <p className="font-mono text-[10px] text-muted-foreground">At least 8 characters.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">{notice}</p>}
            <button type="submit" disabled={busy} className="scan-btn w-full">
              {busy ? "PLEASE WAIT…" : mode === "signin" ? "SIGN IN" : mode === "signup" ? "CREATE ACCOUNT" : "SEND RESET LINK"}
            </button>
          </form>

          <div className="mt-4 text-center font-mono text-xs text-muted-foreground">
            {mode === "signin" && <button onClick={() => switchMode("forgot")} className="hover:text-primary">Forgot password?</button>}
            {mode === "forgot" && <button onClick={() => switchMode("signin")} className="hover:text-primary">← Back to sign in</button>}
          </div>
        </section>
      </main>
    </div>
  );
}

function Field({ label, onChange, ...rest }: { label: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange">) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] tracking-widest text-muted-foreground uppercase">{label}</span>
      <input
        {...rest}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-card/60 px-4 py-2.5 font-mono text-sm outline-none focus:border-primary"
      />
    </label>
  );
}

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid login credentials/i.test(msg)) return "Wrong email or password.";
  if (/email not confirmed/i.test(msg)) return "Please confirm your email first — check your inbox for the link.";
  if (/already registered|already exists/i.test(msg)) return "An account with this email already exists. Try signing in.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/pwned|leaked|weak/i.test(msg)) return "That password is too easy to guess. Please choose a stronger one.";
  return msg;
}
