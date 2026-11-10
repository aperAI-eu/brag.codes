export type PublicProjectContent = {
  title: string;
  problem: string;
  description: string;
  event: string | null;
  language: string | null;
  author: { name: string; contact: string; href: string };
  links: { label: string; url: string }[];
  sections: { label: string; text: string }[];
};
export type PublicationReview = {
  review_id: string;
  draft_version: number;
  publication_version: number;
  expires_at: string;
  publication_revision: number;
  projection_hash: string;
  public_project: PublicProjectContent;
};
export type PublicationReceipt = {
  project_id: string;
  publication_version: number;
  publication_revision: number;
  public_url: string;
  event_url: string | null;
  committed_at: string;
};
export type PublicProject = {
  id: string;
  event_id: string | null;
  publication_version: number;
  published_at: string;
  content: PublicProjectContent;
};

export type PublicProjectSummary = Omit<PublicProject, "content"> & {
  content: Pick<PublicProjectContent, "title" | "problem"> & { author: { name: string } };
};

export type OwnerPublication = {
  revision: number;
  publication_version: number;
  visibility: "published" | "withdrawn" | "hidden";
  owner_withdrawn: boolean;
  public_project: PublicProjectContent;
  selection: {
    public_author: { display_name: string; contact: { kind: "email" | "profile"; value: string } };
    include: { project_link: boolean; repository_link: boolean; details: boolean };
  };
};
export type WithdrawalReceipt = {
  project_id: string;
  withdrawn: true;
  publication_revision: number;
  committed_at: string;
};
