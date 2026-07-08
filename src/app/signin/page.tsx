"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Mail, Lock, User, Github, Music2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "signup") {
      // Create the account first.
      setLoading(true);
      try {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name: name || undefined }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? "Sign-up failed");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign-up failed");
        setLoading(false);
        return;
      }
    }

    // Sign in with the credentials.
    setLoading(true);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push("/");
    router.refresh();
  };

  const handleGitHub = () => {
    signIn("github", { callbackUrl: "/" });
  };

  return (
    <div className="music-bg flex min-h-dvh flex-col items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src="/spotibot-brand.png"
            alt="SpotiBot"
            width={64}
            height={64}
            className="size-16 rounded-2xl shadow-lg shadow-fuchsia-500/25"
          />
          <div className="text-center">
            <h1 className="gradient-text text-2xl font-bold">SpotiBot</h1>
            <p className="text-xs text-muted-foreground">Le bot de musique moderne</p>
          </div>
        </div>

        {/* Card */}
        <div className="glass-card p-6">
          {/* Mode toggle */}
          <div className="mb-5 flex rounded-lg border border-white/10 bg-black/30 p-0.5">
            <button
              type="button"
              onClick={() => { setMode("signin"); setError(null); }}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                mode === "signin" ? "bg-fuchsia-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); setError(null); }}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-all ${
                mode === "signup" ? "bg-fuchsia-500 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (optional)"
                  disabled={loading}
                  className="border-white/10 bg-black/30 pl-9"
                />
              </div>
            )}
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                required
                disabled={loading}
                className="border-white/10 bg-black/30 pl-9"
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
                disabled={loading}
                className="border-white/10 bg-black/30 pl-9"
              />
            </div>

            {error && <p className="text-xs text-rose-400">{error}</p>}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-fuchsia-500 via-purple-500 to-rose-500 text-white hover:brightness-110"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  {mode === "signin" ? "Signing in…" : "Creating account…"}
                </>
              ) : (
                mode === "signin" ? "Sign In" : "Create Account"
              )}
            </Button>
          </form>

          {/* GitHub OAuth (only shown if configured) */}
          {process.env.NEXT_PUBLIC_GITHUB_ENABLED === "true" && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-white/10" />
                or
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <Button
                type="button"
                onClick={handleGitHub}
                disabled={loading}
                variant="outline"
                className="w-full border-white/10 bg-white/5 text-foreground hover:bg-white/10"
              >
                <Github className="mr-2 size-4" aria-hidden />
                Continue with GitHub
              </Button>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground/60">
          By continuing you agree to SpotiBot&apos;s Terms of Service.
        </p>
      </motion.div>
    </div>
  );
}
