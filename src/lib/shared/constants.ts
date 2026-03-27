export const MODULE_LABELS = {
  leads: "Outbound",
  growth: "Inbound",
  platform: "Platform",
} as const;

export const CONTENT_TYPES = [
  { value: "blog_post", label: "Blog Post" },
  { value: "landing_page", label: "Landing Page" },
  { value: "case_study", label: "Case Study" },
  { value: "comparison", label: "Comparison" },
  { value: "guide", label: "Guide" },
  { value: "tool_page", label: "Tool Page" },
] as const;

export const OPPORTUNITY_STATUSES = [
  { value: "discovered", label: "Discovered" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "published", label: "Published" },
  { value: "declined", label: "Declined" },
] as const;

export const DRAFT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
  { value: "needs_update", label: "Needs Update" },
] as const;

export const SEARCH_INTENTS = [
  { value: "informational", label: "Informational" },
  { value: "commercial", label: "Commercial" },
  { value: "transactional", label: "Transactional" },
  { value: "navigational", label: "Navigational" },
] as const;

export const PIPELINE_STAGES = [
  { key: "discovered", label: "Opportunity", description: "Keyword identified, no brief yet" },
  { key: "planned", label: "Brief Created", description: "Brief generated, outline ready" },
  { key: "in_progress", label: "Drafting", description: "Content being written" },
  { key: "review", label: "Review", description: "Draft complete, needs review" },
  { key: "approved", label: "Approved", description: "Ready to publish" },
  { key: "scheduled", label: "Scheduled", description: "Has a publish date" },
  { key: "published", label: "Published", description: "Live on tweakandbuild.com" },
] as const;

export const LEAD_PRIORITIES = [
  { value: "urgent", label: "Urgent", color: "text-red-500" },
  { value: "high", label: "High", color: "text-orange-500" },
  { value: "normal", label: "Normal", color: "text-zinc-400" },
  { value: "low", label: "Low", color: "text-zinc-600" },
] as const;

export const OUTREACH_CHANNELS = [
  { value: "email", label: "Email" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "phone", label: "Phone" },
  { value: "other", label: "Other" },
] as const;

export const SEQUENCE_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "opened", label: "Opened" },
  { value: "replied", label: "Replied" },
  { value: "bounced", label: "Bounced" },
] as const;
