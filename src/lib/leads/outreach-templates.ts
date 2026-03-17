export interface OutreachTemplate {
  id: string;
  name: string;
  channel: "email" | "linkedin" | "follow_up";
  subject?: string;
  body: string;
}

export const OUTREACH_TEMPLATES: OutreachTemplate[] = [
  {
    id: "platform-rebuild",
    name: "Platform Rebuild Pitch",
    channel: "email",
    subject: "Quick question about {{business_name}}'s website",
    body: "Hi — I noticed {{business_name}}'s site is built on {{platform}}. We recently helped a similar {{niche}} business migrate to a custom platform and saw {{metric}}.\n\nWould it be worth a 15-minute call to see if the same approach could work for you?\n\nBest,\nIyad\nTweak & Build",
  },
  {
    id: "speed-fix",
    name: "Speed & Performance",
    channel: "email",
    subject: "Your site loads in {{load_time}}s — we can fix that",
    body: "Hi — I ran a quick check on {{business_name}}'s website and noticed it takes about {{load_time}} seconds to load. That's costing you roughly {{lost_percent}}% of visitors who leave before the page finishes.\n\nWe specialize in rebuilding sites for speed. Our last project cut load times by 80%.\n\nWorth a quick chat?\n\nIyad\nTweak & Build",
  },
  {
    id: "linkedin-intro",
    name: "LinkedIn Introduction",
    channel: "linkedin",
    body: "Hi — came across {{business_name}} and had a specific idea for how your online presence could drive more {{niche}} customers. Mind if I share it?",
  },
  {
    id: "follow-up-value",
    name: "Value-Add Follow Up",
    channel: "follow_up",
    subject: "Re: {{business_name}}'s website",
    body: "Hi — following up on my note from last week. I put together a quick analysis of {{business_name}}'s site:\n\n• Performance: {{performance_grade}}\n• Mobile: {{mobile_status}}\n• Missing: {{missing_items}}\n\nHappy to walk through it on a call if useful.\n\nIyad",
  },
];

export interface TemplateVariables {
  business_name: string;
  platform: string;
  niche: string;
  metric: string;
  load_time: string;
  lost_percent: string;
  performance_grade: string;
  mobile_status: string;
  missing_items: string;
}

export function fillTemplate(
  template: OutreachTemplate,
  vars: TemplateVariables
): { subject?: string; body: string } {
  function replace(text: string): string {
    return text
      .replace(/\{\{business_name\}\}/g, vars.business_name)
      .replace(/\{\{platform\}\}/g, vars.platform)
      .replace(/\{\{niche\}\}/g, vars.niche)
      .replace(/\{\{metric\}\}/g, vars.metric)
      .replace(/\{\{load_time\}\}/g, vars.load_time)
      .replace(/\{\{lost_percent\}\}/g, vars.lost_percent)
      .replace(/\{\{performance_grade\}\}/g, vars.performance_grade)
      .replace(/\{\{mobile_status\}\}/g, vars.mobile_status)
      .replace(/\{\{missing_items\}\}/g, vars.missing_items);
  }

  return {
    subject: template.subject ? replace(template.subject) : undefined,
    body: replace(template.body),
  };
}
