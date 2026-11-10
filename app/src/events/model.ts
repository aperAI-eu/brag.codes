export type ManagedEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  timezone: string;
  starts_at: string;
  submissions_open_at: string;
  submissions_close_at: string;
  approval: string;
  manually_closed: boolean;
  version: number;
  generation: number;
  submission_state: "scheduled" | "open" | "closed";
  canonical_url: string;
  submission_url: string;
  aliases: { id: string; url: string; state: string; version: number }[];
  audit: {
    actor_id: string;
    action: string;
    version: number;
    reason: string;
    created_at: string;
  }[];
};
export type EventList = { events: ManagedEvent[]; next_cursor: string | null };
