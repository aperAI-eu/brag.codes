import { Button, Field, TextInput } from "./components";
import type { IntegrationView } from "../integrations/model";
export type SettingsForm = {
  origin: string;
  model: string;
  token: string;
  key: string;
  removeToken: boolean;
  removeKey: boolean;
  enabled: boolean;
};
export function IntegrationSettingsView({
  settings,
  value,
  busy,
  error,
  notice,
  uncertain,
  onChange,
  onSave,
  onReload,
}: {
  settings: IntegrationView;
  value: SettingsForm;
  busy: boolean;
  error: string;
  notice: string;
  uncertain: boolean;
  onChange: (value: SettingsForm) => void;
  onSave: () => void;
  onReload: () => void;
}) {
  return (
    <section className="access-card integration-settings">
      <p className="eyebrow">ADMINISTRATION</p>
      <h1>Pitch integrations</h1>
      <p className="muted">
        Distill transcribes the 20-second pitch. Claude turns it into an editable project
        description.
      </p>
      {error && (
        <p className="access-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="access-notice" role="status">
          {notice}
        </p>
      )}
      {!settings.storage_ready && (
        <p className="access-error" role="alert">
          Secure storage is unavailable. A server operator must configure or restore its encryption
          key before you can save credentials.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
        autoComplete="off"
      >
        <fieldset
          className="event-workspace"
          disabled={busy || uncertain || !settings.storage_ready}
        >
          <h2>Distill</h2>
          <Field label="Distill API origin" htmlFor="distill-origin">
            <TextInput
              id="distill-origin"
              type="url"
              value={value.origin}
              maxLength={2048}
              placeholder="https://your-distill-host"
              onChange={(e) => onChange({ ...value, origin: e.target.value })}
            />
          </Field>
          <p className="small muted">
            Use a dedicated brag service token and licence. Changing the API origin requires
            entering its token again.
          </p>
          <Field
            label={`Distill service token · ${settings.distill_token_saved ? "Saved" : "Not configured"}`}
            htmlFor="distill-token"
          >
            <TextInput
              id="distill-token"
              type="password"
              name="new-distill-token"
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              value={value.token}
              maxLength={8192}
              disabled={value.removeToken}
              placeholder={
                settings.distill_token_saved
                  ? "Leave blank to keep saved token"
                  : "Enter service token"
              }
              onChange={(e) => onChange({ ...value, token: e.target.value })}
            />
          </Field>
          {settings.distill_token_saved && (
            <label className="integration-toggle">
              <input
                type="checkbox"
                checked={value.removeToken}
                onChange={(e) =>
                  onChange({ ...value, removeToken: e.target.checked, token: "", enabled: false })
                }
              />
              Remove saved Distill token for new pitches
            </label>
          )}
          <h2>Claude</h2>
          <Field
            label={`Anthropic API key · ${settings.anthropic_key_saved ? "Saved" : "Not configured"}`}
            htmlFor="anthropic-key"
          >
            <TextInput
              id="anthropic-key"
              type="password"
              name="new-anthropic-key"
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              value={value.key}
              maxLength={8192}
              disabled={value.removeKey}
              placeholder={
                settings.anthropic_key_saved ? "Leave blank to keep saved key" : "Enter API key"
              }
              onChange={(e) => onChange({ ...value, key: e.target.value })}
            />
          </Field>
          {settings.anthropic_key_saved && (
            <label className="integration-toggle">
              <input
                type="checkbox"
                checked={value.removeKey}
                onChange={(e) =>
                  onChange({ ...value, removeKey: e.target.checked, key: "", enabled: false })
                }
              />
              Remove saved Anthropic key for new pitches
            </label>
          )}
          <Field label="Claude model ID" htmlFor="claude-model">
            <TextInput
              id="claude-model"
              value={value.model}
              maxLength={90}
              placeholder="Explicit model ID from Anthropic"
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            />
          </Field>
          <label className="integration-toggle">
            <input
              type="checkbox"
              checked={value.enabled}
              disabled={value.removeToken || value.removeKey}
              onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
            />
            Enable voice processing for new pitches
          </label>
          <p className="small muted">
            Existing pitches finish with their original settings. Saved keys are encrypted and never
            shown again. Save does not test credentials or make paid API calls.
          </p>
          <Button type="submit" disabled={busy}>
            Save settings
          </Button>
        </fieldset>
      </form>
      {uncertain && (
        <p className="access-notice">
          The save may have succeeded. Reload the saved status before entering another change.
        </p>
      )}
      <Button variant="quiet" disabled={busy} onClick={onReload}>
        Reload saved settings
      </Button>
      {settings.updated_at && (
        <p className="small muted">
          Revision {settings.version} · Saved {new Date(settings.updated_at).toLocaleString()}
        </p>
      )}
    </section>
  );
}
