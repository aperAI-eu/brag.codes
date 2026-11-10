import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { initials, sourceLabels, type Project, type PublicAuthor } from "./model";

export type IconName =
  | "arrow"
  | "back"
  | "search"
  | "plus"
  | "bookmark"
  | "check"
  | "close"
  | "code"
  | "lock"
  | "mail"
  | "external"
  | "pin"
  | "clock"
  | "spark"
  | "layers"
  | "wave"
  | "loop"
  | "grid"
  | "terminal"
  | "leaf"
  | "paper"
  | "chevron"
  | "copy";
const paths: Record<IconName, ReactNode> = {
  arrow: (
    <>
      <path d="M4 12h15M13 5l7 7-7 7" />
    </>
  ),
  back: (
    <>
      <path d="M20 12H5m6-7-7 7 7 7" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  bookmark: <path d="M6 4h12v17l-6-4-6 4z" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  external: <path d="M13 3h8v8m0-8L10 14m-1-9H4v15h15v-5" />,
  pin: (
    <>
      <path d="M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 0 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  spark: <path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z" />,
  layers: (
    <>
      <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5" />
    </>
  ),
  wave: <path d="M3 10c3-9 5 13 9 3s6-10 9-2M3 15c3-9 5 13 9 3s6-10 9-2" />,
  loop: (
    <>
      <path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6" />
      <path d="M9 8v8l6-4Z" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 8 4 4-4 4m7 0h5" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 3C4 1 1 13 7 18s16-1 13-15ZM6 21 17 8" />
    </>
  ),
  paper: (
    <>
      <path d="M6 2h9l4 4v16H6Zm8 0v5h5M9 12h7m-7 4h7" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  children: ReactNode;
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "coral";
}) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function Avatar({ author, large = false }: { author: PublicAuthor; large?: boolean }) {
  return (
    <span
      className={`avatar ${large ? "avatar-large" : ""}`}
      style={{ background: author.color }}
      aria-hidden="true"
    >
      {initials(author.name)}
    </span>
  );
}

export function ProjectMark({ project, large = false }: { project: Project; large?: boolean }) {
  return (
    <div
      className={`project-mark ${large ? "project-mark-large" : ""}`}
      style={{ background: project.color }}
    >
      <Icon name={project.symbol} size={large ? 38 : 28} />
    </div>
  );
}

export function ProjectCard({
  project,
  saved,
  onSave,
  onOpen,
}: {
  project: Project;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
}) {
  return (
    <article className="project-card">
      <div className="card-top">
        <ProjectMark project={project} />
        <span className={`maturity ${project.status === "Daily use" ? "is-live" : ""}`}>
          <span />
          {project.status}
        </span>
        <button
          className={`icon-button save ${saved ? "is-saved" : ""}`}
          onClick={onSave}
          aria-label={`${saved ? "Unsave" : "Save"} ${project.title}`}
          aria-pressed={saved}
        >
          <Icon name="bookmark" size={19} />
        </button>
      </div>
      <button className="card-title" onClick={onOpen}>
        <h3>{project.title}</h3>
        <Icon name="arrow" size={20} />
      </button>
      <p className="card-description">{project.tagline}</p>
      <div className="takeaway">
        <Icon name="spark" size={15} />
        <span>{project.takeaway}</span>
      </div>
      <div className="tag-list">
        {project.tags.slice(0, 3).map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </div>
      <div className="card-footer">
        <span className="author-inline">
          <Avatar author={project.author} />
          {project.author.name}
        </span>
        <span className="source-label">
          <Icon
            name={
              project.source === "private" ? "lock" : project.source === "public" ? "code" : "paper"
            }
            size={13}
          />
          {project.source === "description"
            ? "Described"
            : project.source === "private"
              ? "Private repo"
              : "Public repo"}
        </span>
      </div>
    </article>
  );
}

export function AuthorCard({ author }: { author: PublicAuthor }) {
  const href = author.contactKind === "email" ? `mailto:${author.contact}` : author.contact;
  return (
    <aside className="author-panel">
      <p className="eyebrow">THE PERSON BEHIND IT</p>
      <Avatar author={author} large />
      <h3>{author.name}</h3>
      <p className="muted">{author.role || "Independent builder"}</p>
      <p className="author-invitation">Something in common? A good conversation starts here.</p>
      <a
        className="button button-primary full-width"
        href={href}
        {...(author.contactKind === "profile"
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        <Icon name={author.contactKind === "email" ? "mail" : "external"} size={17} />
        {author.contactKind === "email"
          ? `Email ${author.name.split(" ")[0]}`
          : "Open public profile"}
      </a>
      <span className="contact-value">{author.contact}</span>
      <p className="small muted">Shared by the author. No introduction request needed.</p>
    </aside>
  );
}

export function ProjectStory({ project }: { project: Project }) {
  return (
    <div className="project-story">
      <div className="detail-heading">
        <ProjectMark project={project} large />
        <div>
          <div className="tag-list">
            <Tag tone="green">{project.status}</Tag>
            <span className="small muted">{sourceLabels[project.source]}</span>
          </div>
          <h1>{project.title}</h1>
          <p className="detail-tagline">{project.tagline}</p>
        </div>
      </div>
      <section>
        <h2>The problem</h2>
        <p>{project.problem}</p>
      </section>
      <section>
        <h2>What I built</h2>
        <p className="preserve-lines">{project.description}</p>
      </section>
      <section className="detail-takeaway">
        <p className="eyebrow">
          <Icon name="spark" size={16} /> SOMETHING TO TAKE AWAY
        </p>
        <p>{project.takeaway}</p>
      </section>
      <section>
        <h2>What to know before trying it</h2>
        <p>
          {project.limitation ||
            "The author has not added limitations yet. Ask them what to expect."}
        </p>
      </section>
      <div className="tag-list">
        {project.tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {hint && (
        <p className="field-hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="text-input" {...props} />;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">
        <Icon name="search" size={30} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Stepper({ step }: { step: number }) {
  return (
    <ol className="stepper" aria-label="Submission progress">
      {["Your project", "Your details", "Review & share"].map((label, index) => (
        <li
          key={label}
          className={index === step ? "current" : index < step ? "complete" : ""}
          aria-current={index === step ? "step" : undefined}
        >
          <span>{index < step ? <Icon name="check" size={13} /> : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
