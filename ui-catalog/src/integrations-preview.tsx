"use client";
import { useState } from "react";
import { IntegrationSettingsView, type SettingsForm } from "../../app/src/ui/integration-settings";
import type { IntegrationView } from "../../app/src/integrations/model";
const initial: IntegrationView = {
  version: 1,
  storage_ready: true,
  enabled: false,
  distill_origin: "https://distill.example.com",
  claude_model: "claude-example-model",
  distill_token_saved: false,
  anthropic_key_saved: false,
  updated_at: null,
  updated_by: null,
};
export function IntegrationsPreview() {
  const [settings, setSettings] = useState(initial),
    [notice, setNotice] = useState("");
  const [value, setValue] = useState<SettingsForm>({
    origin: initial.distill_origin,
    model: initial.claude_model,
    enabled: false,
    token: "",
    key: "",
    removeToken: false,
    removeKey: false,
  });
  const reset = () =>
    setValue((v) => ({ ...v, token: "", key: "", removeToken: false, removeKey: false }));
  return (
    <>
      <p className="access-notice">
        Catalogue only. Use fictional credentials here. Nothing is sent or saved to a server.
      </p>
      <IntegrationSettingsView
        settings={settings}
        value={value}
        onChange={setValue}
        busy={false}
        error=""
        notice={notice}
        uncertain={false}
        onReload={reset}
        onSave={() => {
          setSettings((s) => ({
            ...s,
            version: s.version + 1,
            enabled: value.enabled,
            distill_origin: value.origin,
            claude_model: value.model,
            distill_token_saved: !value.removeToken && (!!value.token || s.distill_token_saved),
            anthropic_key_saved: !value.removeKey && (!!value.key || s.anthropic_key_saved),
          }));
          reset();
          setNotice("Fixture saved. Real settings use the authenticated Admin interface.");
        }}
      />
    </>
  );
}
