export type EventMetadata = {
  status: "loaded" | "partial" | "unavailable";
  source_url: string;
  fields: {
    title?: string;
    description?: string;
    location?: string;
    timezone?: string;
    starts_at?: string;
  };
};
