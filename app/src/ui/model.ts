export type SourceKind = "description" | "public" | "private";
export type ProjectIntent = "tool" | "pattern";

export interface PublicAuthor {
  name: string;
  role: string;
  contact: string;
  contactKind: "email" | "profile";
  color: string;
}

export interface Project {
  id: string;
  title: string;
  tagline: string;
  problem: string;
  description: string;
  takeaway: string;
  limitation: string;
  tags: string[];
  source: SourceKind;
  intent: ProjectIntent;
  status: "Daily use" | "Prototype" | "Early idea";
  event: "bratislava" | "vienna";
  author: PublicAuthor;
  color: string;
  symbol: "layers" | "wave" | "loop" | "grid" | "terminal" | "leaf" | "spark" | "paper";
  feedback: boolean;
}

export const sourceLabels: Record<SourceKind, string> = {
  description: "Author described",
  public: "Public repository",
  private: "Private repository",
};

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

export function publicProjectExport(project: Project) {
  return {
    schema_version: "prototype-1",
    project_id: project.id,
    title: project.title,
    problem: project.problem,
    description: project.description,
    useful_detail: project.takeaway,
    limitations: project.limitation,
    tags: project.tags,
    provenance: sourceLabels[project.source],
    public_author: {
      display_name: project.author.name,
      contacts: [{ kind: project.author.contactKind, value: project.author.contact }],
    },
  };
}
