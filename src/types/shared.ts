export type Module = 'leads' | 'growth' | 'platform';

export interface ActivityLogEntry {
  id: string;
  module: Module;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  user_id: string | null;
  created_at: string;
}

export interface PlatformStats {
  leads: {
    total: number;
    hot: number;
    contacted_this_week: number;
  };
  growth: {
    opportunities: number;
    drafts_in_progress: number;
    published: number;
    clicks_this_month: number;
  };
  recent_activity: ActivityLogEntry[];
}
