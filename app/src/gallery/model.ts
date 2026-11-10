import type { PublicProjectSummary } from "../publication/model";
export type GalleryProject = PublicProjectSummary & {
  event: { id: string; title: string } | null;
  url: string;
  matched_fields: string[];
};
export type GalleryPage = {
  schema_version: 1;
  projects: GalleryProject[];
  next_cursor: string | null;
  snapshot_at: string;
};
export type GalleryEvents = {
  schema_version: 1;
  events: { id: string; title: string }[];
  next_cursor: string | null;
  snapshot_at: string;
};
