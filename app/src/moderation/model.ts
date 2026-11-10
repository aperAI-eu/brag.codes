import type { ModerationEntry } from "../ui/moderation";
export type ModerationProject = ModerationEntry & { event_id: string | null };
export type ModerationPage = { projects: ModerationProject[]; next_cursor: string | null };
export type ModerationEvents = {
  events: { id: string; title: string }[];
  next_cursor: string | null;
};
export type ModerationReceipt = {
  project_id: string;
  action: "hide" | "restore";
  revision: number;
  hidden: boolean;
  owner_withdrawn: boolean;
  committed_at: string;
};
