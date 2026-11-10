import type { BetterAuthPlugin } from "better-auth";
import { getOAuthState } from "better-auth/api";
import { AuthFailure } from "./diagnostics.ts";

/** Fixed endpoints, bounded bodies and no redirect-following for private provider data. */
async function providerJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    throw new AuthFailure("github_transport");
  });
  if (!response.ok || !response.body) throw new AuthFailure("github_http");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    content = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) {
      await reader.cancel();
      throw new AuthFailure("github_body");
    }
    content += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(content + decoder.decode()) as unknown;
  } catch {
    throw new AuthFailure("github_body");
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validEmail = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function githubBoundary(credentials: {
  clientId: string;
  clientSecret: string;
}): BetterAuthPlugin {
  return {
    id: "brag-github-oauth",
    init(context) {
      if (!Array.isArray(context.socialProviders)) throw new Error("Unsupported auth adapter");
      context.socialProviders = context.socialProviders.map((provider) => {
        if (provider.id !== "github") return provider;
        return {
          ...provider,
          // Authorization-server issuer (RFC 9207), separate from the stored account namespace.
          issuer: "https://github.com/login/oauth",
          async validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
            if (!codeVerifier || (await getOAuthState())?.serverContext?.provider !== "github")
              throw new AuthFailure("github_flow");
            const data = await providerJson("https://github.com/login/oauth/access_token", {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                code,
                code_verifier: codeVerifier,
                redirect_uri: redirectURI,
              }),
            });
            if (record(data) && data.error) {
              const reason =
                data.error === "incorrect_client_credentials"
                  ? "github_credentials"
                  : data.error === "redirect_uri_mismatch"
                    ? "github_redirect"
                    : data.error === "bad_verification_code"
                      ? "github_code"
                      : "github_exchange";
              throw new AuthFailure(reason);
            }
            if (
              !record(data) ||
              data.error ||
              data.token_type !== "bearer" ||
              typeof data.access_token !== "string" ||
              !/^[A-Za-z0-9_.-]{1,4096}$/.test(data.access_token)
            )
              throw new AuthFailure("github_exchange");
            return { accessToken: data.access_token, scopes: ["read:user", "user:email"] };
          },
          async getUserInfo(tokens) {
            if (!tokens.accessToken) return null;
            const headers = {
              Accept: "application/vnd.github+json",
              "User-Agent": "brag.codes",
              "X-GitHub-Api-Version": "2022-11-28",
              Authorization: `Bearer ${tokens.accessToken}`,
            };
            const profile = await providerJson("https://api.github.com/user", { headers });
            if (
              !record(profile) ||
              !Number.isSafeInteger(profile.id) ||
              Number(profile.id) <= 0 ||
              profile.type !== "User"
            )
              throw new AuthFailure("github_profile");
            const emails = await providerJson("https://api.github.com/user/emails?per_page=100", {
              headers,
            });
            if (!Array.isArray(emails) || emails.length > 100)
              throw new AuthFailure("github_emails");
            const verified = emails.filter(
              (email): email is Record<string, unknown> & { email: string } =>
                record(email) && email.verified === true && validEmail(email.email),
            );
            const selected =
              verified.find((email) => email.primary === true) ??
              verified.find((email) => email.email === profile.email) ??
              verified.sort((a, b) => a.email.localeCompare(b.email))[0];
            return {
              user: {
                name:
                  typeof profile.name === "string" && profile.name.trim()
                    ? profile.name.slice(0, 200)
                    : typeof profile.login === "string"
                      ? profile.login.slice(0, 200)
                      : "brag user",
                email: selected?.email.toLowerCase() ?? "",
                emailVerified: !!selected,
              },
              data: { id: profile.id },
            };
          },
        };
      });
    },
  };
}
