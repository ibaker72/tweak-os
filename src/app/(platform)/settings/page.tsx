"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatPhoneNumber } from "@/lib/phone";
import {
  Settings,
  LogOut,
  Key,
  Shield,
  Users,
  FileText,
  List,
  Bell,
  Plus,
  Trash2,
  Save,
  Loader2,
  Plug,
  CheckCircle2,
  XCircle,
  PhoneCall,
} from "lucide-react";

/**
 * Enough of an email check to catch a typo before spending a round trip. The
 * route validates properly with zod and normalises the address; this only
 * exists so "mary@" does not have to travel to the server to be refused.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Agent {
  id: string;
  display_name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

interface Template {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  sort_order: number;
  is_active: boolean;
}

interface SmartList {
  id: string;
  name: string;
  icon: string;
  description: string | null;
  filters: Record<string, unknown>;
}

export default function SettingsPage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [smartLists, setSmartLists] = useState<SmartList[]>([]);
  const [loading, setLoading] = useState(true);

  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  // Whatever the server last said about this card, shown in the card. Every
  // path below sets it — including the failures, which is the whole point.
  const [agentMessage, setAgentMessage] = useState<
    { tone: "ok" | "warn" | "error"; text: string } | null
  >(null);

  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [editTemplateData, setEditTemplateData] = useState<Partial<Template>>({});

  // The caller's own Twilio callback number — the phone click-to-call rings
  // first. Self-service for this one column only; everything else on an
  // agent_profiles row is still admin-write.
  //
  // `savedVoicePhone` is what the database holds and `voicePhoneDraft` is what
  // is in the box. Keeping them apart is the point: the previous version had
  // only the box, so an empty box meant both "nothing is saved" and "erase what
  // is saved", and pressing Save on it silently wiped the number.
  const [savedVoicePhone, setSavedVoicePhone] = useState<string | null>(null);
  const [voicePhoneDraft, setVoicePhoneDraft] = useState("");
  const [savingVoicePhone, setSavingVoicePhone] = useState(false);
  const [clearingVoicePhone, setClearingVoicePhone] = useState(false);
  const [confirmClearVoicePhone, setConfirmClearVoicePhone] = useState(false);
  const [voicePhoneMessage, setVoicePhoneMessage] = useState<
    { tone: "ok" | "warn" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/agents").then((r) => r.json()).catch(() => ({ agents: [] })),
      fetch("/api/outreach/templates").then((r) => r.json()).catch(() => ({ templates: [] })),
      fetch("/api/smart-lists").then((r) => r.json()).catch(() => ({ smart_lists: [] })),
      fetch("/api/my/voice-phone").then((r) => r.json()).catch(() => ({ voice_phone: null })),
    ]).then(([agentData, templateData, smartListData, voiceData]) => {
      setAgents(agentData.agents ?? []);
      setTemplates(templateData.templates ?? []);
      setSmartLists(smartListData.smart_lists ?? []);
      // The box starts empty even when a number is saved: the saved value is
      // shown above it as text, so there is nothing for a placeholder to be
      // mistaken for.
      setSavedVoicePhone(voiceData.voice_phone ?? null);
      setVoicePhoneDraft("");
      setLoading(false);
    });
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  /**
   * Apply the callback number, or erase it.
   *
   * Erasing is its own call with `clear: true`. An empty box is never an
   * instruction — the route refuses a blank body without that flag, and this
   * does not send one.
   */
  async function submitVoicePhone(intent: "save" | "clear") {
    const clearing = intent === "clear";
    const trimmed = voicePhoneDraft.trim();

    if (!clearing && !trimmed) {
      setVoicePhoneMessage({
        tone: "error",
        text: "Type your callback number first — an empty box does not change anything.",
      });
      return;
    }

    if (clearing) setClearingVoicePhone(true);
    else setSavingVoicePhone(true);
    setVoicePhoneMessage(null);

    try {
      const res = await fetch("/api/my/voice-phone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice_phone: clearing ? null : trimmed,
          clear: clearing,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        // The server returns what it read back out of the column, so this
        // shows the stored value rather than what was typed.
        const stored: string | null = data.voice_phone ?? null;
        setSavedVoicePhone(stored);
        setVoicePhoneDraft("");
        setVoicePhoneMessage(
          stored
            ? {
                tone: "ok",
                text: `Saved. Twilio will ring ${formatPhoneNumber(stored)} when you press Call via Twilio.`,
              }
            : {
                tone: "warn",
                text: "Callback number removed. Twilio calling is off for your account until you set one.",
              }
        );
        // The lead page renders this value on the server, and Next keeps the
        // last render of it in the client router cache. Without this, walking
        // straight from here to a lead can show the number that was there a
        // moment ago.
        router.refresh();
      } else {
        setVoicePhoneMessage({
          tone: "error",
          text: data.error ?? "Could not save your callback number.",
        });
      }
    } catch (err) {
      console.error("Save voice phone error:", err);
      setVoicePhoneMessage({ tone: "error", text: "Network error while saving." });
    } finally {
      setSavingVoicePhone(false);
      setClearingVoicePhone(false);
      setConfirmClearVoicePhone(false);
    }
  }

  /**
   * Invite a teammate, or link the login they already have.
   *
   * The server does the real work — resolve or create the auth user, then
   * write the agent_profiles row. All this has to get right is refusing
   * obviously bad input before spending a round trip, and never throwing the
   * response away.
   *
   * The previous version read `data.agent` and ignored everything else, so a
   * 400 looked exactly like nothing happening — and every submission got a
   * 400, because the route wanted an auth.users id the browser has no way to
   * know. A silent button is the worst of both: the admin cannot tell whether
   * the agent was added, so they press it again.
   */
  async function handleCreateAgent() {
    const name = newAgentName.trim();
    const email = newAgentEmail.trim().toLowerCase();

    if (!name) {
      setAgentMessage({ tone: "error", text: "Enter the agent's name." });
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setAgentMessage({ tone: "error", text: "Enter a valid email address." });
      return;
    }

    setCreatingAgent(true);
    setAgentMessage(null);

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Name and email only. The role is the server's to decide, and there
        // is no user_id to send.
        body: JSON.stringify({ display_name: name, email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.agent) {
        // data.error is the route's own sentence — "That user already has an
        // agent profile", and so on. Shown as written; the raw Supabase error
        // never reaches here.
        setAgentMessage({
          tone: "error",
          text: data.error ?? "Could not send the invitation. Try again.",
        });
        return;
      }

      const created = data.agent as Agent;
      // Kept in the order GET /api/agents returns, so a refresh does not
      // reshuffle the list.
      setAgents(
        [...agents, created].sort((a, b) => a.display_name.localeCompare(b.display_name))
      );
      setNewAgentName("");
      setNewAgentEmail("");
      setAgentMessage({
        tone: "ok",
        text:
          data.outcome === "linked"
            ? `${created.email} already had a login — it is now linked as an agent.`
            : `Invitation sent to ${created.email}.`,
      });
    } catch (err) {
      console.error("Create agent error:", err);
      setAgentMessage({
        tone: "error",
        text: "Network error while sending the invitation. Try again.",
      });
    } finally {
      setCreatingAgent(false);
    }
  }

  /**
   * Activate or deactivate a teammate.
   *
   * Reads the response instead of assuming it worked. The route refuses an
   * admin deactivating their own account — the optimistic version flipped the
   * badge anyway, so the one control that stops an admin locking themselves
   * out looked like it had failed to stop them.
   */
  async function handleToggleAgent(id: string, isActive: boolean) {
    setAgentMessage(null);
    try {
      const res = await fetch("/api/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_active: !isActive }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.agent) {
        setAgentMessage({
          tone: "error",
          text: data.error ?? "Could not update that agent.",
        });
        return;
      }

      // Reflect what was stored, not what was asked for.
      const updated = data.agent as Agent;
      setAgents(agents.map((a) => (a.id === id ? { ...a, ...updated } : a)));
    } catch (err) {
      console.error("Toggle agent error:", err);
      setAgentMessage({
        tone: "error",
        text: "Network error while updating that agent.",
      });
    }
  }

  async function handleSaveTemplate(id: string) {
    await fetch("/api/outreach/templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editTemplateData }),
    });
    setTemplates(templates.map((t) => (t.id === id ? { ...t, ...editTemplateData } as Template : t)));
    setEditingTemplate(null);
    setEditTemplateData({});
  }

  async function handleDeleteTemplate(id: string) {
    await fetch("/api/outreach/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setTemplates(templates.filter((t) => t.id !== id));
  }

  async function handleDeleteSmartList(id: string) {
    await fetch("/api/smart-lists", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setSmartLists(smartLists.filter((l) => l.id !== id));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Manage your Tweak&amp;Build OS configuration</p>
      </div>

      {/* Twilio calling — the agent's own callback number */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <PhoneCall className="h-5 w-5 text-lime-400" />
            Twilio Calling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-400">
            When you press <strong className="text-zinc-200">Call via Twilio</strong>{" "}
            on a lead, Twilio rings this number first. Answer it and you are
            connected to the prospect, who sees the Tweak &amp; Build number —
            never this one.
          </p>

          {/* What is actually stored, stated separately from the input. The
              two used to be the same box, which is how a placeholder could be
              mistaken for a saved value. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <span className="text-xs font-medium uppercase text-zinc-500">
              Saved number
            </span>
            {savedVoicePhone ? (
              <>
                <span className="font-mono text-sm text-zinc-100">
                  {formatPhoneNumber(savedVoicePhone)}
                </span>
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <CheckCircle2 className="h-3 w-3" />
                  Twilio calling ready
                </Badge>
              </>
            ) : (
              <>
                <span className="text-sm text-amber-300">None saved</span>
                <Badge variant="outline" className="gap-1 text-[10px] text-zinc-500">
                  <XCircle className="h-3 w-3" />
                  Twilio calling off
                </Badge>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={voicePhoneDraft}
              onChange={(e) => setVoicePhoneDraft(e.target.value)}
              // Deliberately not a complete, plausible number: a grey
              // placeholder that reads as a real value is what got the
              // original number erased.
              placeholder={
                savedVoicePhone
                  ? "Type a new number to replace it"
                  : "Type your callback number"
              }
              className="flex-1"
              inputMode="tel"
              aria-label="Callback phone number"
            />
            <Button
              size="sm"
              onClick={() => submitVoicePhone("save")}
              disabled={
                savingVoicePhone ||
                clearingVoicePhone ||
                voicePhoneDraft.trim().length === 0
              }
              title={
                voicePhoneDraft.trim().length === 0
                  ? "Type a number first"
                  : undefined
              }
            >
              <Save className="h-4 w-4" />
              {savingVoicePhone ? "Saving..." : "Save"}
            </Button>
            {savedVoicePhone && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmClearVoicePhone(true)}
                disabled={savingVoicePhone || clearingVoicePhone}
              >
                <Trash2 className="h-4 w-4" />
                {clearingVoicePhone ? "Removing..." : "Remove"}
              </Button>
            )}
          </div>

          <p className="text-xs text-zinc-500">
            US numbers may be typed any way you like — (862) 298-4988 and
            8622984988 both work; anything else needs full E.164 form. Use
            Remove to turn Twilio calling off for your account: leaving the box
            empty changes nothing. This is the only field on your profile you
            can change yourself — rates, role, and payout details are
            admin-only.
          </p>

          {voicePhoneMessage && (
            <p
              className={`text-sm ${
                voicePhoneMessage.tone === "ok"
                  ? "text-lime-400"
                  : voicePhoneMessage.tone === "warn"
                    ? "text-amber-300"
                    : "text-red-400"
              }`}
            >
              {voicePhoneMessage.text}
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmClearVoicePhone}
        onOpenChange={(open) => !clearingVoicePhone && setConfirmClearVoicePhone(open)}
        title="Remove your callback number?"
        description={
          savedVoicePhone
            ? `Twilio will no longer ring ${formatPhoneNumber(savedVoicePhone)}, and Call via Twilio will be unavailable on every lead until you set a number again.`
            : "Twilio calling will be unavailable until you set a number again."
        }
        confirmLabel="Remove number"
        busy={clearingVoicePhone}
        onConfirm={() => submitVoicePhone("clear")}
      />

      {/* Team Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-lime-400" />
            Team Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {agents.length > 0 ? (
            <div className="space-y-2">
              {agents.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between rounded-lg bg-zinc-800/50 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-lime-400/20 text-xs font-bold text-lime-400">
                      {agent.display_name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{agent.display_name}</p>
                      <p className="text-xs text-zinc-500">{agent.email}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{agent.role}</Badge>
                    {!agent.is_active && (
                      <Badge variant="outline" className="text-[10px] text-zinc-500">Inactive</Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleToggleAgent(agent.id, agent.is_active)}>
                    {agent.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No agents yet.</p>
          )}
          <div className="border-t border-zinc-800 pt-4">
            <p className="mb-1 text-xs font-medium text-zinc-500">Invite Agent</p>
            <p className="mb-2 text-xs text-zinc-500">
              Emails an invitation to that address and creates their agent
              profile. The link asks them to choose a password and then drops
              them on their dashboard. Someone who already has a login is
              linked to a profile instead — no second account, no second email,
              and their existing password still works.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Full name"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                className="flex-1"
                aria-label="New agent name"
                disabled={creatingAgent}
              />
              <Input
                type="email"
                inputMode="email"
                placeholder="name@company.com"
                value={newAgentEmail}
                onChange={(e) => setNewAgentEmail(e.target.value)}
                className="flex-1"
                aria-label="New agent email"
                disabled={creatingAgent}
              />
              <Button
                size="sm"
                onClick={handleCreateAgent}
                disabled={creatingAgent || !newAgentName.trim() || !newAgentEmail.trim()}
              >
                {creatingAgent ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {creatingAgent ? "Inviting..." : "Invite Agent"}
              </Button>
            </div>
            {agentMessage && (
              <p
                className={`mt-2 text-sm ${
                  agentMessage.tone === "ok"
                    ? "text-lime-400"
                    : agentMessage.tone === "warn"
                      ? "text-amber-300"
                      : "text-red-400"
                }`}
                role="status"
              >
                {agentMessage.text}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Outreach Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-lime-400" />
            Outreach Templates
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              {editingTemplate === template.id ? (
                <div className="space-y-2">
                  <Input value={editTemplateData.name ?? template.name} onChange={(e) => setEditTemplateData({ ...editTemplateData, name: e.target.value })} placeholder="Template name" />
                  {template.channel === "email" && (
                    <Input value={editTemplateData.subject ?? template.subject ?? ""} onChange={(e) => setEditTemplateData({ ...editTemplateData, subject: e.target.value })} placeholder="Subject line" />
                  )}
                  <Textarea value={editTemplateData.body ?? template.body} onChange={(e) => setEditTemplateData({ ...editTemplateData, body: e.target.value })} rows={4} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSaveTemplate(template.id)}><Save className="h-3.5 w-3.5" />Save</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setEditingTemplate(null); setEditTemplateData({}); }}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-200">{template.name}</p>
                      <Badge variant="secondary" className="text-[10px]">{template.channel}</Badge>
                    </div>
                    {template.subject && <p className="mt-1 text-xs text-zinc-500">Subject: {template.subject}</p>}
                    <p className="mt-1 text-xs text-zinc-600 line-clamp-2">{template.body}</p>
                    {template.variables && template.variables.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {template.variables.map((v) => (
                          <span key={v} className="text-[10px] text-lime-400/60">{`{{${v}}}`}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditingTemplate(template.id); setEditTemplateData({}); }}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => handleDeleteTemplate(template.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Smart Lists */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <List className="h-5 w-5 text-lime-400" />
            Smart Lists
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {smartLists.length > 0 ? (
            smartLists.map((list) => (
              <div key={list.id} className="flex items-center justify-between rounded-lg bg-zinc-800/50 p-3">
                <div>
                  <p className="text-sm font-medium text-zinc-200">{list.name}</p>
                  {list.description && <p className="text-xs text-zinc-500">{list.description}</p>}
                </div>
                <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => handleDeleteSmartList(list.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-zinc-500">No custom smart lists. Default lists are shown in the sidebar.</p>
          )}
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bell className="h-5 w-5 text-lime-400" />
            Notification Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-zinc-500">Coming soon — email notifications for key events.</p>
          {[
            { label: "New hot leads (score 70+)", enabled: false },
            { label: "Overdue follow-ups", enabled: false },
            { label: "Agent replies received", enabled: false },
          ].map((pref) => (
            <div key={pref.label} className="flex items-center justify-between rounded-lg bg-zinc-800/50 p-3">
              <span className="text-sm text-zinc-300">{pref.label}</span>
              <div className="flex h-5 w-9 items-center rounded-full bg-zinc-700 p-0.5">
                <div className="h-4 w-4 rounded-full bg-zinc-500 transition-transform" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Key className="h-5 w-5 text-lime-400" />
            API Keys
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">API keys are managed through environment variables on the server.</p>
          <div className="space-y-3">
            {[
              { name: "ANTHROPIC_API_KEY", description: "Claude (Haiku 4.5) — AI outreach and proposal generation" },
              { name: "GOOGLE_PLACES_API_KEY", description: "Business discovery via Google Places" },
              { name: "GOOGLE_CUSTOM_SEARCH_API_KEY", description: "Google Custom Search discovery" },
              { name: "GOOGLE_CUSTOM_SEARCH_CX", description: "Google Custom Search engine ID" },
              { name: "NEXT_PUBLIC_SUPABASE_URL", description: "Supabase project URL" },
              { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", description: "Supabase public anon key" },
              { name: "SUPABASE_SERVICE_ROLE_KEY", description: "Supabase service-role key (server-side only)" },
              { name: "TWILIO_ACCOUNT_SID", description: "Twilio account — shared by SMS and voice" },
              { name: "TWILIO_AUTH_TOKEN", description: "Twilio auth token — also validates inbound webhook signatures" },
              { name: "TWILIO_FROM_NUMBER", description: "The number prospects see. Must be voice-capable" },
              { name: "TWILIO_VOICE_ENABLED", description: "Click-to-call kill switch. No call is placed while false" },
            ].map((key) => (
              <div key={key.name} className="flex flex-col gap-2 rounded-lg bg-zinc-800/50 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-zinc-200">{key.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{key.description}</p>
                </div>
                <span className="shrink-0 self-start rounded bg-lime-400/10 px-2 py-0.5 text-[10px] text-lime-400">Set via env</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5 text-lime-400" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">Authentication powered by Supabase Auth.</p>
          <Button variant="outline" onClick={handleSignOut} disabled={signingOut}>
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
            <p><strong className="text-zinc-200">Tweak&amp;Build OS</strong> — Internal operating system for Tweak &amp; Build Studio</p>
            <p>Modules: Outbound (Lead Engine) + Inbound (Growth Engine)</p>
            <p className="text-xs text-zinc-600 mt-4">Internal Tool — Tweak & Build Studio {new Date().getFullYear()}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
