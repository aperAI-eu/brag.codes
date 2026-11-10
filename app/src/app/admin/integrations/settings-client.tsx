"use client";
import { useEffect, useRef, useState } from "react";
import type { IntegrationView, IntegrationInput } from "../../../integrations/model";
import { IntegrationSettingsView, type SettingsForm } from "../../../ui/integration-settings";
const form = (s: IntegrationView): SettingsForm => ({
  origin: s.distill_origin,
  model: s.claude_model,
  enabled: s.enabled,
  token: "",
  key: "",
  removeToken: false,
  removeKey: false,
});
const messages: Record<string, string> = {
  version_conflict: "Another administrator changed these settings. Reload before saving again.",
  invalid_distill_origin: "Enter a public HTTPS origin, without a path, port or query.",
  distill_token_required_for_origin_change: "Enter the Distill token for the new API origin.",
  invalid_claude_model: "Enter an explicit Claude model ID, without a latest alias.",
  invalid_credential: "Enter a valid token or key without spaces or line breaks.",
  configuration_incomplete:
    "Set the API origin, both credentials and model before enabling voice processing.",
  credential_storage_unavailable:
    "Secure storage is unavailable. Ask the server operator to check the encryption key.",
  rate_limited: "Too many requests. Wait a minute, then reload.",
};
export default function SettingsClient() {
  const [settings, setSettings] = useState<IntegrationView | null>(null),
    [value, setValue] = useState<SettingsForm | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false),
    [denied, setDenied] = useState(false);
  const mounted = useRef(true),
    inFlight = useRef(false);
  const clearSecrets = () =>
    setValue((v) => (v ? { ...v, token: "", key: "", removeKey: false, removeToken: false } : v));
  async function request(body?: IntegrationInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    let knownRejection = false;
    try {
      const response = await fetch("/api/v1/admin/integrations", {
        method: body ? "POST" : "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
        headers: body
          ? { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }
          : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok) {
        knownRejection = response.status < 500;
        if ([401, 403].includes(response.status)) {
          setDenied(true);
          setSettings(null);
          setValue(null);
          throw new Error("Admin access is unavailable. Sign in again or check your role.");
        }
        if (body && response.status >= 500) setUncertain(true);
        throw new Error(
          messages[data.error?.code] || "Could not save settings. Reload and try again.",
        );
      }
      setSettings(data.settings);
      setValue(form(data.settings));
      setUncertain(false);
      setNotice(
        body
          ? "Settings saved. Credentials remain hidden; provider connectivity has not been tested."
          : "",
      );
    } catch (e) {
      if (mounted.current) {
        setError(
          e instanceof Error && e.name === "Error"
            ? e.message
            : "Request not confirmed. Reload saved settings.",
        );
        if (body && !knownRejection) setUncertain(true);
      }
    } finally {
      if (mounted.current) {
        clearSecrets();
        setBusy(false);
      }
      inFlight.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    void request();
    return () => {
      mounted.current = false;
    };
  }, []);
  return denied ? (
    <p className="access-error" role="alert">
      {error}
    </p>
  ) : settings && value ? (
    <IntegrationSettingsView
      settings={settings}
      value={value}
      busy={busy}
      error={error}
      notice={notice}
      uncertain={uncertain}
      onChange={setValue}
      onReload={() => void request()}
      onSave={() => {
        const input: IntegrationInput = {
          expected_version: settings.version,
          distill_origin: value.origin,
          claude_model: value.model,
          enabled: value.enabled,
        };
        if (value.removeToken || value.token)
          input.distill_token = value.removeToken ? null : value.token;
        if (value.removeKey || value.key) input.anthropic_key = value.removeKey ? null : value.key;
        clearSecrets();
        void request(input);
      }}
    />
  ) : (
    <section className="access-card">
      <p role={error ? "alert" : "status"}>{error || "Loading integration settings…"}</p>
      {error && <button onClick={() => void request()}>Retry</button>}
    </section>
  );
}
