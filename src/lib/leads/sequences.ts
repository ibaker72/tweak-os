import { SupabaseClient } from "@supabase/supabase-js";

export interface SequenceEntry {
  id: string;
  lead_id: string;
  agent_id: string | null;
  channel: string;
  sequence_step: number;
  subject: string | null;
  body: string | null;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  scheduled_for: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSequenceData {
  lead_id: string;
  agent_id?: string;
  channel: string;
  subject?: string;
  body?: string;
  status?: string;
  scheduled_for?: string;
  notes?: string;
}

export async function createSequenceEntry(
  supabase: SupabaseClient,
  data: CreateSequenceData
): Promise<SequenceEntry> {
  // Get next sequence step for this lead
  const { count } = await supabase
    .from("outreach_sequences")
    .select("*", { count: "exact", head: true })
    .eq("lead_id", data.lead_id);

  const nextStep = (count ?? 0) + 1;

  const { data: entry, error } = await supabase
    .from("outreach_sequences")
    .insert({
      lead_id: data.lead_id,
      agent_id: data.agent_id ?? null,
      channel: data.channel,
      sequence_step: nextStep,
      subject: data.subject ?? null,
      body: data.body ?? null,
      status: data.status ?? "draft",
      scheduled_for: data.scheduled_for ?? null,
      notes: data.notes ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return entry as SequenceEntry;
}

export async function getSequenceForLead(
  supabase: SupabaseClient,
  leadId: string
): Promise<SequenceEntry[]> {
  const { data, error } = await supabase
    .from("outreach_sequences")
    .select("*")
    .eq("lead_id", leadId)
    .order("sequence_step", { ascending: true });

  if (error) throw error;
  return (data as SequenceEntry[]) ?? [];
}

export async function getDueSequences(
  supabase: SupabaseClient,
  agentId?: string,
  date?: string
): Promise<(SequenceEntry & { lead_name?: string })[]> {
  const targetDate = date ?? new Date().toISOString().split("T")[0];
  const startOfDay = `${targetDate}T00:00:00.000Z`;
  const endOfDay = `${targetDate}T23:59:59.999Z`;

  let query = supabase
    .from("outreach_sequences")
    .select("*, leads!inner(business_name)")
    .gte("scheduled_for", startOfDay)
    .lte("scheduled_for", endOfDay)
    .in("status", ["draft", "sent"]);

  if (agentId) {
    query = query.eq("agent_id", agentId);
  }

  const { data, error } = await query.order("scheduled_for", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const leads = row.leads as { business_name: string } | null;
    const { leads: _leads, ...rest } = row;
    return {
      ...rest,
      lead_name: leads?.business_name ?? undefined,
    } as unknown as SequenceEntry & { lead_name?: string };
  });
}

export async function markSequenceSent(
  supabase: SupabaseClient,
  sequenceId: string
): Promise<void> {
  const { error } = await supabase
    .from("outreach_sequences")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .eq("id", sequenceId);
  if (error) throw error;
}

export async function markSequenceReplied(
  supabase: SupabaseClient,
  sequenceId: string
): Promise<void> {
  // Get the sequence to find the lead
  const { data: seq, error: fetchError } = await supabase
    .from("outreach_sequences")
    .select("lead_id")
    .eq("id", sequenceId)
    .single();
  if (fetchError) throw fetchError;

  // Update sequence
  const { error } = await supabase
    .from("outreach_sequences")
    .update({
      status: "replied",
      replied_at: new Date().toISOString(),
    })
    .eq("id", sequenceId);
  if (error) throw error;

  // Update lead lifecycle to replied
  if (seq?.lead_id) {
    await supabase
      .from("leads")
      .update({ lifecycle_status: "replied" })
      .eq("id", seq.lead_id);
  }
}

export interface OutreachStats {
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
}

export async function getOutreachStats(
  supabase: SupabaseClient,
  dateRange?: { start: string; end: string }
): Promise<OutreachStats> {
  const start = dateRange?.start ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  })();
  const end = dateRange?.end ?? new Date().toISOString();

  const [sentRes, openedRes, repliedRes, bouncedRes] = await Promise.all([
    supabase
      .from("outreach_sequences")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", start)
      .lte("sent_at", end),
    supabase
      .from("outreach_sequences")
      .select("*", { count: "exact", head: true })
      .eq("status", "opened")
      .gte("opened_at", start)
      .lte("opened_at", end),
    supabase
      .from("outreach_sequences")
      .select("*", { count: "exact", head: true })
      .eq("status", "replied")
      .gte("replied_at", start)
      .lte("replied_at", end),
    supabase
      .from("outreach_sequences")
      .select("*", { count: "exact", head: true })
      .eq("status", "bounced")
      .gte("created_at", start)
      .lte("created_at", end),
  ]);

  return {
    sent: sentRes.count ?? 0,
    opened: openedRes.count ?? 0,
    replied: repliedRes.count ?? 0,
    bounced: bouncedRes.count ?? 0,
  };
}
