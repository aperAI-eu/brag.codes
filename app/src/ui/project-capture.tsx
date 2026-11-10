import { languageLabel } from "../projects/language";
import type { ProjectFields } from "../projects/model";
import { Button, Field, Icon, TextInput } from "./components";
export function CaptureChoices({
  onChoose,
  pitchSeconds = 20,
}: {
  onChoose: (method: "typed" | "voice" | "agent") => void;
  pitchSeconds?: 20 | 30;
}) {
  return (
    <>
      <h1>How would you like to share it?</h1>
      <p className="muted">Choose a way to prepare your project description.</p>
      <div className="capture-choices">
        <Button variant="secondary" onClick={() => onChoose("typed")}>
          <Icon name="paper" size={24} />
          <span>
            <strong>Type it in</strong>
            <small>A name and a few useful sentences.</small>
          </span>
          <Icon name="arrow" size={18} />
        </Button>
        <Button variant="secondary" onClick={() => onChoose("voice")}>
          <Icon name="wave" size={24} />
          <span>
            <strong>Record your pitch</strong>
            <small>{pitchSeconds} seconds. Talk it through, then review the draft.</small>
          </span>
          <Icon name="arrow" size={18} />
        </Button>
        <Button variant="secondary" onClick={() => onChoose("agent")}>
          <Icon name="code" size={24} />
          <span>
            <strong>Use your AI agent</strong>
            <small>Continue from your project workspace.</small>
          </span>
          <Icon name="arrow" size={18} />
        </Button>
      </div>
    </>
  );
}
export function ProjectLinks({
  value,
  onChange,
  disabled = false,
}: {
  value: ProjectFields;
  onChange: (value: ProjectFields) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Field
        label="Project link (optional)"
        htmlFor="project-url"
        hint="Your live app, website or demo."
      >
        <TextInput
          id="project-url"
          type="url"
          maxLength={2048}
          placeholder="https://"
          value={value.project_url}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, project_url: e.target.value })}
        />
      </Field>
      <Field
        label="Repository link (optional)"
        htmlFor="repository-url"
        hint="GitHub, GitLab or another HTTPS repository link."
      >
        <TextInput
          id="repository-url"
          type="url"
          maxLength={2048}
          placeholder="https://"
          value={value.repository_url}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, repository_url: e.target.value })}
        />
      </Field>
    </>
  );
}
export function ProjectEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ProjectFields;
  onChange: (value: ProjectFields) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <ProjectLanguage language={value.language} />
      <Field label="Project name" htmlFor="project-title">
        <TextInput
          id="project-title"
          maxLength={120}
          value={value.title}
          disabled={disabled}
          placeholder="Give it a name"
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </Field>
      <Field label="What problem does it solve?" htmlFor="project-problem">
        <textarea
          className="text-input"
          id="project-problem"
          rows={3}
          maxLength={1000}
          value={value.problem}
          disabled={disabled}
          placeholder="Who is it for, and what gets easier?"
          onChange={(e) => onChange({ ...value, problem: e.target.value })}
        />
      </Field>
      <Field label="What did you build?" htmlFor="project-description">
        <textarea
          className="text-input"
          id="project-description"
          rows={6}
          maxLength={10000}
          value={value.description}
          disabled={disabled}
          placeholder="The idea, what works, what you learned…"
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </Field>
      <ProjectLinks value={value} onChange={onChange} disabled={disabled} />
      <ProjectDetailsEditor value={value} onChange={onChange} disabled={disabled} />
    </>
  );
}

export function ProjectDetailsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ProjectFields;
  onChange: (value: ProjectFields) => void;
  disabled?: boolean;
}) {
  const d = value.details;
  const change = (patch: Partial<ProjectFields["details"]>) =>
    onChange({ ...value, details: { ...d, ...patch } });
  const process = (patch: Partial<typeof d.process>) =>
    change({ process: { ...d.process, ...patch } });
  const text = (
    key: string,
    label: string,
    content: string,
    update: (s: string) => void,
    maxLength = 2000,
  ) => (
    <Field key={key} label={label} htmlFor={"details-" + key}>
      <textarea
        id={"details-" + key}
        className="text-input"
        rows={3}
        value={content}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => update(e.target.value)}
      />
    </Field>
  );
  const select = (
    key: string,
    label: string,
    current: string | null,
    options: [string, string][],
    update: (v: string | null) => void,
  ) => (
    <Field label={label} htmlFor={"details-" + key}>
      <select
        id={"details-" + key}
        className="text-input"
        value={current ?? ""}
        disabled={disabled}
        onChange={(e) => update(e.target.value || null)}
      >
        <option value="">Not specified</option>
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <details className="project-details">
      <summary>Additional project details (optional)</summary>
      <p className="small muted">
        Review what your pitch supplied. Leave anything you haven’t described blank.
      </p>
      {text("core", "Core idea", d.core_idea, (core_idea) => change({ core_idea }), 1000)}
      {(
        [
          ["capabilities", "What it can do"],
          ["constraints", "Constraints"],
          ["limitations", "Known limitations"],
          ["stack", "Technology stack"],
          ["looking_for", "What you’re looking for"],
        ] as const
      ).map(([key, label]) =>
        text(
          key,
          label + " — one item per line",
          d[key].join("\n"),
          (v) => change({ [key]: v.split("\n") }),
          6019,
        ),
      )}
      {select(
        "maturity",
        "Project maturity",
        d.reality_level,
        [
          ["idea", "Idea"],
          ["prototype", "Prototype"],
          ["daily_driver", "Used regularly"],
          ["production", "In production"],
        ],
        (v) => change({ reality_level: v as typeof d.reality_level }),
      )}
      {select(
        "demo",
        "Can you demonstrate it?",
        d.can_demo === null ? null : String(d.can_demo),
        [
          ["true", "Yes"],
          ["false", "No"],
        ],
        (v) => change({ can_demo: v === null ? null : v === "true" }),
      )}
      <h3>How you built it</h3>
      {text(
        "tools",
        "Tools used — one per line",
        d.process.tools.join("\n"),
        (v) => process({ tools: v.split("\n") }),
        6019,
      )}
      {text("workflow", "Workflow", d.process.workflow, (workflow) => process({ workflow }))}
      {select(
        "hours",
        "Approximate effort",
        d.process.hours_bucket,
        [
          ["under_2", "Under 2 hours"],
          ["2_8", "2–8 hours"],
          ["8_40", "8–40 hours"],
          ["over_40", "Over 40 hours"],
        ],
        (v) => process({ hours_bucket: v as typeof d.process.hours_bucket }),
      )}
      <Field label="Share built with AI (%)" htmlFor="details-agent-share">
        <TextInput
          id="details-agent-share"
          type="number"
          min={0}
          max={100}
          step={1}
          value={d.process.agent_share ?? ""}
          disabled={disabled}
          onChange={(e) =>
            process({ agent_share: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </Field>
      {text(
        "gotchas",
        "Lessons and gotchas",
        d.process.gotchas,
        (gotchas) => process({ gotchas }),
        3000,
      )}
      {select(
        "again",
        "Would you build it this way again?",
        d.process.would_build_again,
        [
          ["yes", "Yes"],
          ["differently", "Differently"],
          ["no", "No"],
        ],
        (v) => process({ would_build_again: v as typeof d.process.would_build_again }),
      )}
      <h3>Patterns worth sharing</h3>
      <p className="small muted">
        Ideas in the system or in how you built it. Describe evidence you have; these claims are not
        independently verified.
      </p>
      {d.patterns.map((p, index) => {
        const update = (patch: Partial<typeof p>) =>
          change({
            patterns: d.patterns.map((item) => (item.id === p.id ? { ...item, ...patch } : item)),
          });
        return (
          <fieldset key={p.id} className="project-pattern">
            <legend>Pattern {index + 1}</legend>
            {select(
              p.id + "-kind",
              "Kind",
              p.kind,
              [
                ["system", "System design"],
                ["process", "Building process"],
              ],
              (v) => {
                if (v) update({ kind: v as typeof p.kind });
              },
            )}
            {text(p.id + "-name", "Pattern name", p.name, (name) => update({ name }), 120)}
            {text(p.id + "-description", "How it works", p.description, (description) =>
              update({ description }),
            )}
            {text(
              p.id + "-evidence",
              "Evidence or example",
              p.evidence,
              (evidence) => update({ evidence }),
              1000,
            )}
            <p className="small muted">
              {p.source === "agent_inferred" ? "Suggested by an agent" : "Author reported"}
            </p>
            {!disabled && (
              <Button
                variant="quiet"
                onClick={() => change({ patterns: d.patterns.filter((item) => item.id !== p.id) })}
              >
                Remove pattern {index + 1}
              </Button>
            )}
          </fieldset>
        );
      })}
      {!disabled && (
        <Button
          variant="secondary"
          disabled={d.patterns.length >= 8}
          onClick={() =>
            change({
              patterns: [
                ...d.patterns,
                {
                  id: crypto.randomUUID(),
                  kind: "system",
                  name: "",
                  description: "",
                  evidence: "",
                  source: "author_reported",
                },
              ],
            })
          }
        >
          Add a pattern
        </Button>
      )}
      {text(
        "license",
        "Code license, if known",
        d.code_license,
        (code_license) => change({ code_license }),
        300,
      )}
      {text(
        "permission",
        "Notes about sharing the description",
        d.catalogue_text_permission,
        (catalogue_text_permission) => change({ catalogue_text_permission }),
        1000,
      )}
      <p className="small muted">
        These notes do not publish your project or grant access to a repository.
      </p>
    </details>
  );
}

export function ProjectLanguage({
  language,
  detected = false,
}: {
  language?: string | null;
  detected?: boolean;
}) {
  if (!language) return null;
  return (
    <p className="small muted">
      {detected ? "Detected language" : "Content language"}: {languageLabel(language)}
    </p>
  );
}
