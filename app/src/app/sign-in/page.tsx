"use client";

import { useEffect, useState } from "react";
import { SignInView, type SignInProvider } from "../../ui/access";

export default function SignIn() {
  const [available, setAvailable] = useState<SignInProvider[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("auth");
    if (reason)
      setError(
        reason === "link_required"
          ? "This email belongs to an existing account. Sign in with its existing method. Provider linking is not available yet."
          : reason === "email_required"
            ? "GitHub did not provide a verified email. Verify an email on GitHub and try again, or choose another sign-in method."
            : reason === "cancelled"
              ? "Sign-in was cancelled. You can try again."
              : "Sign-in didn’t finish. Try again in the browser where you started.",
      );
    fetch("/api/v1/auth/providers", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        setAvailable(
          (["Google", "GitHub"] as const).filter((name) =>
            data.providers.some(
              (provider: { id: string; enabled: boolean }) =>
                provider.id === name.toLowerCase() && provider.enabled === true,
            ),
          ),
        );
      })
      .catch(() => setError("Sign-in is temporarily unavailable. Please try again."));
  }, []);
  async function start(provider: SignInProvider) {
    if (!["Google", "GitHub"].includes(provider) || !available.includes(provider) || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/auth/providers/${provider.toLowerCase()}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "sign_in",
          return_to: new URLSearchParams(window.location.search).get("return_to") || "/",
        }),
      });
      if (!response.ok) throw new Error();
      const { url } = await response.json();
      const destination = new URL(url);
      if (
        destination.username ||
        destination.password ||
        (provider === "Google"
          ? destination.origin !== "https://accounts.google.com"
          : destination.origin !== "https://github.com" ||
            destination.pathname !== "/login/oauth/authorize")
      )
        throw new Error();
      window.location.assign(destination.href);
    } catch {
      setError("Couldn’t start sign-in. Please try again.");
      setBusy(false);
    }
  }
  return (
    <main className="access-main">
      <SignInView
        error={error}
        available={available}
        busy={busy}
        onProvider={(provider) => void start(provider)}
        onCancel={() => window.location.assign("/")}
      />
    </main>
  );
}
