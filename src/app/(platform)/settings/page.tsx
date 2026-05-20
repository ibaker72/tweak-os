"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

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

  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [editTemplateData, setEditTemplateData] = useState<Partial<Template>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/agents").then((r) => r.json()).catch(() => ({ agents: [] })),
      fetch("/api/outreach/templates").then((r) => r.json()).catch(() => ({ templates: [] })),
      fetch("/api/smart-lists").then((r) => r.json()).catch(() => ({ smart_lists: [] })),
    ]).then(([agentData, templateData, smartListData]) => {
      setAgents(agentData.agents ?? []);
      setTemplates(templateData.templates ?? []);
      setSmartLists(smartListData.smart_lists ?? []);
      setLoading(false);
    });
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleCreateAgent() {
    if (!newAgentName || !newAgentEmail) return;
    setCreatingAgent(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: newAgentName, email: newAgentEmail, role: "agent" }),
      });
      const data = await res.json();
      if (data.agent) {
        setAgents([...agents, data.agent]);
        setNewAgentName("");
        setNewAgentEmail("");
      }
    } catch (err) {
      console.error("Create agent error:", err);
    } finally {
      setCreatingAgent(false);
    }
  }

  async function handleToggleAgent(id: string, isActive: boolean) {
    await fetch("/api/agents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_active: !isActive }),
    });
    setAgents(agents.map((a) => (a.id === id ? { ...a, is_active: !isActive } : a)));
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
        <p className="mt-1 text-sm text-zinc-400">Manage your Tweak OS configuration</p>
      </div>

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
            <p className="mb-2 text-xs font-medium text-zinc-500">Add Agent</p>
            <div className="flex gap-2">
              <Input placeholder="Name" value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} className="flex-1" />
              <Input placeholder="Email" value={newAgentEmail} onChange={(e) => setNewAgentEmail(e.target.value)} className="flex-1" />
              <Button size="sm" onClick={handleCreateAgent} disabled={creatingAgent || !newAgentName || !newAgentEmail}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
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
              { name: "ANTHROPIC_API_KEY", description: "Claude (Haiku 4.5) — AI outreach, brief/draft generation, keyword research" },
              { name: "GOOGLE_PLACES_API_KEY", description: "Business discovery via Google Places" },
              { name: "GOOGLE_CUSTOM_SEARCH_API_KEY", description: "Google Custom Search discovery" },
              { name: "GOOGLE_CUSTOM_SEARCH_CX", description: "Google Custom Search engine ID" },
              { name: "OPENCLAW_MASTER_KEY", description: "OpenClaw automation hub — required by /api/v1/automate" },
              { name: "OPENCLAW_API_BASE_URL", description: "Optional override for OpenClaw endpoint (default: https://api.clawhub.ai)" },
              { name: "NEXT_PUBLIC_SUPABASE_URL", description: "Supabase project URL" },
              { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", description: "Supabase public anon key" },
              { name: "SUPABASE_SERVICE_ROLE_KEY", description: "Supabase service-role key (server-side only, used by automation proxy)" },
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
            <p><strong className="text-zinc-200">Tweak OS</strong> — Internal operating system for Tweak & Build Studio</p>
            <p>Modules: Outbound (Lead Engine) + Inbound (Growth Engine)</p>
            <p className="text-xs text-zinc-600 mt-4">Internal Tool — Tweak & Build Studio {new Date().getFullYear()}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
