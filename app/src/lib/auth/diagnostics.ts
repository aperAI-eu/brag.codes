const categories = new Set([
  "callback_state",
  "callback_request",
  "callback_issuer",
  "callback_nonce",
  "callback_destination",
  "callback_cookie",
  "callback_provider",
  "callback_expired",
  "callback_response",
  "callback_redirect_unknown",
  "callback_email_invalid",
  "callback_cancelled",
  "account_session",
  "account_signup",
  "account_link",
  "code_exchange",
  "provider_identity",
  "account_identity",
  "missing_email",
  "account_collision",
  "account_storage",
  "callback_unexpected",
  "github_flow",
  "github_transport",
  "github_http",
  "github_body",
  "github_exchange",
  "github_credentials",
  "github_redirect",
  "github_code",
  "github_profile",
  "github_emails",
]);
export class AuthFailure extends Error {
  constructor(readonly category: string) {
    super("Authentication failed");
  }
}
export function authDiagnostic(category: string) {
  console.error("Authentication request failed:", categories.has(category) ? category : "unknown");
}
const libraryMessages = new Map([
  ["Failed to parse state", "callback_state"],
  ["State not found", "callback_state"],
  ["INVALID_CALLBACK_REQUEST", "callback_request"],
  ["OAuth issuer mismatch", "callback_issuer"],
  [
    "OAuth id_token nonce binding required but no expected nonce was found in state",
    "callback_nonce",
  ],
  ["No callback URL found", "callback_destination"],
  ["signup_disabled", "account_signup"],
  ["unable_to_create_session", "account_session"],
  ["unable_to_create_user", "account_storage"],
  ["unable_to_update_account", "account_storage"],
  ["unable_to_link_account", "account_link"],
  ["Unable to link account", "account_link"],
  ["Unable to link account - untrusted provider", "account_link"],
  [
    "OAuth account references a missing user. Repair the account before retrying authentication.",
    "account_link",
  ],
  ["Failed to validate authorization code", "code_exchange"],
  ["Unable to get user info", "provider_identity"],
  ["Unable to derive provider account identity", "account_identity"],
  ["account_not_linked", "account_collision"],
  ["Unable to create OAuth user", "account_storage"],
  ["Better auth was unable to query your database.\nError: ", "account_storage"],
]);
for (const provider of ["github", "google"])
  libraryMessages.set(
    `Provider "${provider}" did not return an email. Either request the provider's email scope, or create a placeholder via \`mapProfileToUser\`. See https://www.better-auth.com/docs/concepts/oauth#handling-providers-without-email`,
    "missing_email",
  );
/** Never print library arguments, raw provider responses or exception messages. */
export function authLibraryDiagnostic(_level: string, message: unknown, ...args: unknown[]) {
  const failure = args.find((arg) => arg instanceof AuthFailure);
  authDiagnostic(
    failure instanceof AuthFailure
      ? failure.category
      : (libraryMessages.get(String(message)) ?? "unknown"),
  );
}

const callbackErrors = new Map([
  ["state_not_found", "callback_state"],
  ["state_mismatch", "callback_state"],
  ["state_security_mismatch", "callback_state"],
  ["invalid_callback_request", "callback_request"],
  ["issuer_mismatch", "callback_issuer"],
  ["nonce_binding_missing", "callback_nonce"],
  ["no_callback_url", "callback_destination"],
  ["invalid_code", "code_exchange"],
  ["unable_to_get_user_info", "provider_identity"],
  ["email_not_found", "missing_email"],
  ["INVALID_EMAIL", "callback_email_invalid"],
  ["account_not_linked", "account_collision"],
  ["unable_to_create_session", "account_session"],
  ["unable_to_create_user", "account_storage"],
  ["unable_to_link_account", "account_link"],
  ["signup_disabled", "account_signup"],
  ["access_denied", "callback_cancelled"],
]);
/** Observe the adapter's outcome without logging its redirect or error payload. */
export function authCallbackDiagnostic(error: string | null) {
  authDiagnostic(
    error === null
      ? "callback_response"
      : (callbackErrors.get(error) ?? "callback_redirect_unknown"),
  );
}
