"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/brand/Logo";
import { Loader2 } from "lucide-react";
import {
  applyNewPassword,
  establishInviteSession,
  parseInviteParams,
  PASSWORD_MIN_LENGTH,
  POST_SETUP_REDIRECT,
  type InviteAuthPort,
} from "@/lib/auth/invite-session";

/**
 * Finish account setup — where an invitation link lands.
 *
 * An invited teammate arrives here with a session in the URL fragment and no
 * password. This page turns that into a signed-in session and lets them choose
 * one; from then on they use the ordinary email-and-password login page, which
 * is untouched.
 *
 * All of the decision-making lives in lib/auth/invite-session.ts, including why
 * the fragment has to be read by hand rather than left to the SDK. This is the
 * shell: capture the URL, ask, and render one of four states.
 *
 * Nothing here can set a password for an account other than the one whose
 * session the client holds — `updateUser` acts on that session and takes no
 * user id — so the page has no account to name and nothing to choose.
 */

/**
 * Typed rather than cast, so the real client is checked against the narrow
 * surface the logic is allowed to use.
 */
function browserAuth(): InviteAuthPort {
  return createClient().auth;
}

type Stage = "checking" | "ready" | "invalid" | "done";

export default function SetupPasswordPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Strict Mode runs an effect twice in development. A second pass would spend
  // a `code` or a `token_hash` that the first pass already consumed, and the
  // page would call a good invitation expired.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Read before anything else touches it. The fragment survives the SDK's
    // failed detection (see lib/auth/invite-session.ts), but it is the only
    // copy of the session there is, so it is captured first.
    const { hash, search, pathname } = window.location;
    const params = parseInviteParams(hash, search);

    let cancelled = false;

    establishInviteSession(browserAuth(), params)
      .then((result) => {
        // The tokens have served their purpose. Taking them out of the address
        // bar keeps them off the next screenshot, out of the browser history
        // entry, and out of any Referer this page later sends.
        if (hash || search) {
          window.history.replaceState(window.history.state, "", pathname);
        }
        if (cancelled) return;

        if (result.ok) {
          setEmail(result.email);
          setStage("ready");
        } else {
          setProblem(result.message);
          setStage("invalid");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setProblem("Could not check your invitation. Reload the page and try again.");
        setStage("invalid");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    setSaving(true);

    try {
      const result = await applyNewPassword(browserAuth(), password, confirmation);

      if (!result.ok) {
        setProblem(result.message);
        // A session that has gone away is not something the form can fix.
        if (result.reason === "session") setStage("invalid");
        return;
      }

      setPassword("");
      setConfirmation("");
      setStage("done");
      // A fixed destination. Nothing on the URL chooses where this goes.
      router.replace(POST_SETUP_REDIRECT);
      router.refresh();
    } catch (err) {
      // The error only — never the password, and never the session token.
      console.error("Set password error:", err);
      setProblem("Network error while saving your password. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex items-center justify-center">
            <Logo size={48} />
          </div>
          <CardTitle className="text-xl">
            {stage === "invalid" ? "Invitation problem" : "Finish account setup"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stage === "checking" && (
            <div
              className="flex flex-col items-center gap-3 py-6 text-sm text-zinc-400"
              role="status"
            >
              <Loader2 className="h-6 w-6 animate-spin text-lime-400" />
              Checking your invitation...
            </div>
          )}

          {stage === "invalid" && (
            <div className="space-y-4" role="status">
              <p className="text-sm text-red-400">{problem}</p>
              <p className="text-sm text-zinc-400">
                If you already have a password, you can sign in normally.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            </div>
          )}

          {stage === "done" && (
            <div
              className="flex flex-col items-center gap-3 py-6 text-sm text-zinc-400"
              role="status"
            >
              <Loader2 className="h-6 w-6 animate-spin text-lime-400" />
              <span className="text-lime-400">Password set.</span>
              Taking you to your dashboard...
            </div>
          )}

          {stage === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-zinc-400">
                {email ? (
                  <>
                    Choose a password for{" "}
                    <span className="font-medium text-zinc-200">{email}</span>. You
                    will use it to sign in from now on.
                  </>
                ) : (
                  "Choose a password. You will use it to sign in from now on."
                )}
              </p>

              <div>
                <label className="text-sm font-medium text-zinc-400" htmlFor="new-password">
                  New password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  suppressHydrationWarning
                  required
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-zinc-400" htmlFor="confirm-password">
                  Confirm password
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  suppressHydrationWarning
                  required
                  className="mt-1"
                />
              </div>

              <p className="text-xs text-zinc-500">
                At least {PASSWORD_MIN_LENGTH} characters.
              </p>

              {problem && <p className="text-sm text-red-400">{problem}</p>}

              <Button type="submit" className="w-full" disabled={saving} suppressHydrationWarning>
                {saving ? "Saving..." : "Set password and continue"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
