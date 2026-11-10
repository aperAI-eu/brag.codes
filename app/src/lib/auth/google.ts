import type { BetterAuthPlugin } from "better-auth";
import { createRemoteJWKSet, jwtVerify } from "jose";

const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
  timeoutDuration: 5000,
});

/** Enforce a nonce on the redirect flow and use only cryptographically verified claims. */
export function googleBoundary(google: {
  clientId: string;
  clientSecret: string;
}): BetterAuthPlugin {
  return {
    id: "brag-google-oidc",
    init(context) {
      if (!Array.isArray(context.socialProviders)) throw new Error("Unsupported auth adapter");
      context.socialProviders = context.socialProviders.map((provider) => {
        if (provider.id !== "google") return provider;
        return {
          ...provider,
          requiresIdTokenNonce: true,
          async validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
            if (!codeVerifier) throw new Error("Missing proof key");
            const response = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(5000),
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
              },
              body: new URLSearchParams({
                code,
                code_verifier: codeVerifier,
                redirect_uri: redirectURI,
                grant_type: "authorization_code",
                client_id: google.clientId,
                client_secret: google.clientSecret,
              }),
            });
            if (!response.ok || !response.body) throw new Error("Provider exchange unavailable");
            const reader = response.body.getReader();
            let size = 0,
              content = "";
            const decoder = new TextDecoder();
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 65536) {
                await reader.cancel();
                throw new Error("Invalid provider response");
              }
              content += decoder.decode(value, { stream: true });
            }
            const data = JSON.parse(content + decoder.decode());
            if (typeof data.access_token !== "string" || typeof data.id_token !== "string")
              throw new Error("Invalid provider response");
            return {
              accessToken: data.access_token,
              idToken: data.id_token,
              scopes: ["openid", "profile", "email"],
            };
          },
          async createAuthorizationURL(data) {
            if (!data.idTokenNonce) throw new Error("Missing authorization nonce");
            const url = await provider.createAuthorizationURL(data);
            url.searchParams.set("nonce", data.idTokenNonce);
            return url;
          },
          async getUserInfo(tokens) {
            if (!tokens.idToken || !tokens.expectedIdTokenNonce) return null;
            try {
              const { payload } = await jwtVerify(tokens.idToken, keys, {
                algorithms: ["RS256"],
                audience: google.clientId,
                issuer: ["https://accounts.google.com", "accounts.google.com"],
                maxTokenAge: "1h",
                requiredClaims: ["sub", "exp", "iat", "nonce"],
              });
              if (
                payload.nonce !== tokens.expectedIdTokenNonce ||
                !payload.sub ||
                typeof payload.email !== "string" ||
                payload.email_verified !== true
              )
                return null;
              return {
                user: {
                  name: typeof payload.name === "string" ? payload.name : "brag user",
                  email: payload.email,
                  emailVerified: true,
                },
                data: payload,
              };
            } catch {
              return null;
            }
          },
        };
      });
    },
  };
}
