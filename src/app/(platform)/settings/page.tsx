"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings, LogOut, Key, Shield } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Manage your Tweak OS configuration</p>
      </div>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Key className="h-5 w-5 text-emerald-500" />
            API Keys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">
            API keys are managed through environment variables on the server.
            Contact your administrator to update these values.
          </p>
          <div className="space-y-3">
            {[
              { name: "OPENAI_API_KEY", description: "Used for AI outreach, content generation, and keyword research" },
              { name: "GOOGLE_PLACES_API_KEY", description: "Used for business discovery via Google Places" },
              { name: "GOOGLE_CUSTOM_SEARCH_API_KEY", description: "Used for Google Custom Search discovery" },
              { name: "NEXT_PUBLIC_SUPABASE_URL", description: "Supabase project URL" },
            ].map((key) => (
              <div key={key.name} className="flex flex-col gap-2 rounded-lg bg-zinc-800/50 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-zinc-200">{key.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{key.description}</p>
                </div>
                <span className="shrink-0 self-start rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
                  Set via env
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5 text-emerald-500" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">
            Single-user authentication powered by Supabase Auth.
          </p>
          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <LogOut className="h-4 w-4" />
            {signingOut ? "Signing out..." : "Sign Out"}
          </Button>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Settings className="h-5 w-5 text-zinc-500" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-zinc-400">
            <p><strong className="text-zinc-200">Tweak OS</strong> — Internal operating system for Tweak & Build Studio</p>
            <p>Modules: Outbound (Lead Engine) + Inbound (Growth Engine)</p>
            <p className="text-xs text-zinc-600 mt-4">
              Internal Tool — Tweak & Build Studio {new Date().getFullYear()}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
