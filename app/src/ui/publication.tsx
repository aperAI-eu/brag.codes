import type { ProjectFields } from "../projects/model";
import { Button, Field, Icon, Tag, TextInput } from "./components";
import { ProjectEditor } from "./project-capture";

export type PublicationChoices = {
  name: string;
  contactKind: "email" | "profile";
  contact: string;
  includeProjectLink: boolean;
  includeRepositoryLink: boolean;
  includeDetails: boolean;
};
import type { PublicProjectContent } from "../publication/model";
export type { PublicProjectContent } from "../publication/model";

export function PublicationEditorView({
  fields,
  event,
  error,
  onChange,
  onContinue,
  onBack,
  busy = false,
}: {
  busy?: boolean;
  fields: ProjectFields;
  event: string;
  error: string;
  onChange: (fields: ProjectFields) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <section className="access-card publish-flow">
      <Button variant="quiet" disabled={busy} onClick={onBack}>
        <Icon name="back" size={18} /> My projects
      </Button>
      <h1>Your saved project.</h1>
      <div>
        <Tag>{event}</Tag> <Tag>Private</Tag>
      </div>
      <p className="muted">
        Add any missing details, then choose what to share publicly. Optional fields can stay empty.
      </p>
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
      <ProjectEditor value={fields} onChange={onChange} disabled={busy} />
      <Button onClick={onContinue} disabled={busy}>
        Continue to publication <Icon name="arrow" size={18} />
      </Button>
    </section>
  );
}

export function PublicationOptionsView({
  title,
  event,
  choices,
  projectUrl,
  repositoryUrl,
  error,
  onChange,
  onContinue,
  onBack,
  busy = false,
}: {
  busy?: boolean;
  title: string;
  event: string;
  choices: PublicationChoices;
  projectUrl: string;
  repositoryUrl: string;
  error: string;
  onChange: (value: PublicationChoices) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <form
      aria-busy={busy}
      className="access-card publish-flow"
      onSubmit={(e) => {
        e.preventDefault();
        onContinue();
      }}
    >
      <Button type="button" variant="quiet" disabled={busy} onClick={onBack}>
        <Icon name="back" size={18} /> Edit project
      </Button>
      <h1>Choose what to share.</h1>
      <h2>{title}</h2>
      <div>
        <Tag>{event}</Tag>
      </div>
      <p>
        Choose your public name and contact. These will be visible to anyone who visits your
        project.
      </p>
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
      <Field
        label="Public display name"
        htmlFor="publish-name"
        hint="A name or pseudonym people can recognize."
      >
        <TextInput
          id="publish-name"
          disabled={busy}
          value={choices.name}
          required
          maxLength={100}
          onChange={(e) => onChange({ ...choices, name: e.target.value })}
        />
      </Field>
      <Field label="Public contact type" htmlFor="publish-kind">
        <select
          id="publish-kind"
          disabled={busy}
          value={choices.contactKind}
          onChange={(e) =>
            onChange({
              ...choices,
              contactKind: e.target.value as PublicationChoices["contactKind"],
              contact: "",
            })
          }
        >
          <option value="profile">Profile link</option>
          <option value="email">Email</option>
        </select>
      </Field>
      <Field
        label={choices.contactKind === "email" ? "Public email" : "Public profile link"}
        htmlFor="publish-contact"
        hint="Choose a contact you want to make public. Your sign-in email is not added automatically."
      >
        <TextInput
          id="publish-contact"
          disabled={busy}
          type={choices.contactKind === "email" ? "email" : "url"}
          value={choices.contact}
          placeholder={
            choices.contactKind === "email" ? "hello@example.com" : "https://example.com/you"
          }
          required
          onChange={(e) => onChange({ ...choices, contact: e.target.value })}
        />
      </Field>
      <fieldset className="publish-selections" disabled={busy}>
        <legend>Optional public content</legend>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={choices.includeProjectLink}
            disabled={!projectUrl}
            onChange={(e) => onChange({ ...choices, includeProjectLink: e.target.checked })}
          />
          <span>
            Include project link<small>{projectUrl || "No project link added"}</small>
          </span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={choices.includeRepositoryLink}
            disabled={!repositoryUrl}
            onChange={(e) => onChange({ ...choices, includeRepositoryLink: e.target.checked })}
          />
          <span>
            Include repository link<small>{repositoryUrl || "No repository link added"}</small>
          </span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={choices.includeDetails}
            onChange={(e) => onChange({ ...choices, includeDetails: e.target.checked })}
          />
          <span>
            Include additional project details
            <small>
              Capabilities, stack, process and other details you supplied. Check them in the next
              preview.
            </small>
          </span>
        </label>
      </fieldset>
      <Button type="submit" disabled={busy}>
        Review public page <Icon name="arrow" size={18} />
      </Button>
    </form>
  );
}

export function PublicProjectContentView({
  content,
  preview = false,
}: {
  content: PublicProjectContent;
  preview?: boolean;
}) {
  const Title = preview ? "h2" : "h1";
  return (
    <article className="publish-story" aria-label={content.title}>
      <Title>{content.title}</Title>
      <div className="share-project-tags">
        {content.event && <Tag>{content.event}</Tag>}
        {content.language && <Tag>Language: {content.language}</Tag>}
      </div>
      <section>
        <h3>What problem does it solve?</h3>
        <p>{content.problem}</p>
      </section>
      <section>
        <h3>What did you build?</h3>
        <p>{content.description}</p>
      </section>
      {content.sections.map((section) => (
        <section key={section.label}>
          <h3>{section.label}</h3>
          <p>{section.text}</p>
        </section>
      ))}
      {content.links.length > 0 && (
        <section className="publish-links">
          <h3>Project links</h3>
          {content.links.map((link) => (
            <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer">
              {link.label} <Icon name="external" size={16} />
              <span>{link.url}</span>
            </a>
          ))}
        </section>
      )}
      <section className="publish-contact">
        <h3>Shared by {content.author.name}</h3>
        <a href={content.author.href} rel="noopener noreferrer">
          {content.author.contact} <Icon name="external" size={16} />
        </a>
      </section>
    </article>
  );
}

export function PublicationReviewView({
  content,
  reviewed,
  busy,
  error,
  notice,
  onReviewed,
  onEdit,
  onPublish,
  onRefresh,
}: {
  onRefresh?: () => void;
  content: PublicProjectContent;
  reviewed: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onReviewed: (value: boolean) => void;
  onEdit: () => void;
  onPublish: () => void;
}) {
  return (
    <section className="access-card publish-flow" aria-busy={busy}>
      <Button variant="quiet" disabled={busy} onClick={onEdit}>
        <Icon name="back" size={18} /> Edit public details
      </Button>
      <h1>Here’s what people will see.</h1>
      <p className="muted">Anyone, including AI agents, can read this page once you publish it.</p>
      {notice && (
        <p role="status" className="agent-notice">
          {notice}
        </p>
      )}
      <div className="publish-preview">
        <PublicProjectContentView content={content} preview />
      </div>
      <p className="small muted">
        Your recording, transcript, unselected links and sign-in details are not included. Only the
        information shown above will be public.
      </p>
      {error && (
        <p role="alert" className="access-error">
          {error}
        </p>
      )}
      {onRefresh && (
        <Button variant="secondary" disabled={busy} onClick={onRefresh}>
          Reload saved project
        </Button>
      )}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy}
          onChange={(e) => onReviewed(e.target.checked)}
        />
        <span>I have reviewed this project and the public contact details.</span>
      </label>
      <Button onClick={onPublish} disabled={!reviewed || busy}>
        {busy ? "Publishing…" : "Publish project"}
      </Button>
    </section>
  );
}

export function PublicationSuccessView({
  title,
  onProject,
  onEvent,
  hasEvent = true,
}: {
  title: string;
  onProject: () => void;
  onEvent: () => void;
  hasEvent?: boolean;
}) {
  return (
    <section className="access-card publish-flow">
      <p className="eyebrow">PROJECT PUBLISHED</p>
      <h1>{title}</h1>
      <p>
        {hasEvent
          ? "Your project now has a public page and appears with the event’s projects."
          : "Your project now has a public page and appears in Slop Gallery."}
      </p>
      <Button onClick={onProject}>
        View public project <Icon name="arrow" size={18} />
      </Button>
      <Button variant="secondary" onClick={onEvent}>
        {hasEvent ? "View event projects" : "View Slop Gallery"}
      </Button>
    </section>
  );
}

export function PublicEventProjectsView({
  event,
  projects,
  onOpen,
}: {
  event: string;
  projects: (Pick<PublicProjectContent, "title" | "problem"> & {
    id?: string;
    author: { name: string };
  })[];
  onOpen: (id?: string) => void;
}) {
  return (
    <section className="share-list">
      <h1>Projects from {event}</h1>
      <p className="muted">Work shared by the people who built it.</p>
      {projects.length === 0 ? (
        <p>No projects have been published yet.</p>
      ) : (
        <ul className="publish-event-list">
          {projects.map((project) => (
            <li key={project.id ?? project.title} className="share-project-card">
              <h2>
                <Button variant="quiet" onClick={() => onOpen(project.id)}>
                  <span>{project.title}</span>
                  <Icon name="arrow" size={20} />
                </Button>
              </h2>
              <div>
                <Tag>{event}</Tag>
              </div>
              <p>{project.problem}</p>
              <p className="small muted">By {project.author.name}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PublicationPreviewLink({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="catalogue-access-link">
      <h2>Publish your project · proposed journey</h2>
      <p>
        Choose public details, review the page, publish and browse the event. Fictional records
        only.
      </p>
      <Button onClick={onOpen}>Open publication preview</Button>
    </section>
  );
}

export function PublicProjectPageView({
  content,
  eventUrl,
}: {
  content: PublicProjectContent;
  eventUrl: string | null;
}) {
  return (
    <section className="access-card publish-flow">
      <a href={eventUrl ?? "/slop"}>
        <Icon name="back" size={18} /> {eventUrl ? "Event projects" : "Slop Gallery"}
      </a>
      <PublicProjectContentView content={content} />
    </section>
  );
}
