// Starter SMS templates for one-to-one business follow-up.
// Tone: human, low-pressure, never promises rankings / revenue / leads.
// All templates include the Tweak & Build brand and a STOP opt-out.

export interface SmsTemplate {
  id: string;
  name: string;
  description: string;
  body: string;
  variables: SmsTemplateVariable[];
}

export type SmsTemplateVariable =
  | "first_name"
  | "proposal_link"
  | "date"
  | "time"
  | "email";

export const SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: "proposal-followup",
    name: "Proposal follow-up",
    description: "Send the proposal link after a discovery call.",
    body: "Tweak & Build: Hi {{first_name}}, this is Iyad. Following up on your website or booking setup. Here is the proposal link we discussed: {{proposal_link}}. Reply STOP to opt out.",
    variables: ["first_name", "proposal_link"],
  },
  {
    id: "call-reminder",
    name: "Call reminder",
    description: "Remind a lead about an upcoming call.",
    body: "Tweak & Build: Hi {{first_name}}, reminder for our call on {{date}} at {{time}}. Reply here if you need to reschedule. Reply STOP to opt out.",
    variables: ["first_name", "date", "time"],
  },
  {
    id: "quick-checkin",
    name: "Quick check-in",
    description: "Low-pressure check-in on an active conversation.",
    body: "Tweak & Build: Hi {{first_name}}, this is Iyad. Checking in on your website, booking, or lead capture setup. Happy to send details here if texting is easiest. Reply STOP to opt out.",
    variables: ["first_name"],
  },
  {
    id: "post-call-recap",
    name: "Post-call recap",
    description: "Send right after a discovery call.",
    body: "Tweak & Build: Hi {{first_name}}, good speaking with you. I'll send over the next steps for your website/project setup. Reply STOP to opt out.",
    variables: ["first_name"],
  },
  {
    id: "proposal-sent",
    name: "Proposal sent",
    description: "Confirm that a proposal email just went out.",
    body: "Tweak & Build: Hi {{first_name}}, I just sent the proposal to {{email}}. Let me know if you want me to adjust anything or walk through it. Reply STOP to opt out.",
    variables: ["first_name", "email"],
  },
];

export interface SmsTemplateValues {
  first_name?: string;
  proposal_link?: string;
  date?: string;
  time?: string;
  email?: string;
}

export function fillSmsTemplate(
  template: SmsTemplate,
  values: SmsTemplateValues
): string {
  return template.body
    .replace(/\{\{first_name\}\}/g, values.first_name?.trim() || "there")
    .replace(/\{\{proposal_link\}\}/g, values.proposal_link?.trim() || "[proposal link]")
    .replace(/\{\{date\}\}/g, values.date?.trim() || "[date]")
    .replace(/\{\{time\}\}/g, values.time?.trim() || "[time]")
    .replace(/\{\{email\}\}/g, values.email?.trim() || "[email]");
}

// Standard inbound keywords that flip a lead's sms_status to opted_out.
// Match Twilio's documented opt-out list so behavior is predictable for
// recipients who text any of the standard variants.
export const OPT_OUT_KEYWORDS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
] as const;

export function isOptOutKeyword(rawBody: string | null | undefined): boolean {
  if (!rawBody) return false;
  const normalized = rawBody.trim().toUpperCase();
  if (!normalized) return false;
  // Exact match — guards against false positives like "STOP BY"
  return (OPT_OUT_KEYWORDS as readonly string[]).includes(normalized);
}

export function isHelpKeyword(rawBody: string | null | undefined): boolean {
  if (!rawBody) return false;
  return rawBody.trim().toUpperCase() === "HELP";
}

export const HELP_REPLY_BODY =
  "Tweak & Build: Reply STOP to opt out. For help, email hello@tweakandbuild.com.";

export const SMS_DISABLED_MESSAGE =
  "SMS prepared — waiting for Twilio A2P approval.";

export const SMS_COMPLIANCE_NOTE =
  "Use SMS only for relevant business follow-up, appointment coordination, proposal links, support replies, and active lead/client conversations. Do not use this for bulk outreach. Reply STOP requests are automatically honored.";

export const SMS_SEND_WARNING =
  "Use SMS only for relevant business follow-up. STOP requests are automatically honored.";

export const SMS_OPT_BACK_IN_WARNING =
  "This lead previously opted out. Only mark as allowed if they explicitly opted back in to receive SMS from Tweak & Build.";
