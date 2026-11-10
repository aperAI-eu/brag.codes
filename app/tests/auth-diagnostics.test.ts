import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuthFailure,
  authDiagnostic,
  authLibraryDiagnostic,
  authCallbackDiagnostic,
} from "../src/lib/auth/diagnostics.ts";
test("authentication diagnostics retain only fixed categories, never provider or database material", () => {
  const messages: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => {
    messages.push(args);
  };
  try {
    authLibraryDiagnostic(
      "error",
      "Failed to validate authorization code",
      new AuthFailure("github_credentials"),
      { secret: "private-marker" },
    );
    authLibraryDiagnostic("error", "private-marker", new Error("private-marker"));
    authLibraryDiagnostic("error", "Unable to create OAuth user", { email: "private-marker" });
    authDiagnostic("private-marker");
    authLibraryDiagnostic("error", "known", new AuthFailure("private-marker"));
    assert.deepEqual(
      messages.map((message) => message[1]),
      ["github_credentials", "unknown", "account_storage", "unknown", "unknown"],
    );
    assert.equal(JSON.stringify(messages).includes("private-marker"), false);
  } finally {
    console.error = original;
  }
});

test("callback refusal categories distinguish known stages without logging URLs or error details", () => {
  const messages: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => {
    messages.push(args);
  };
  try {
    for (const [message, category] of [
      ["OAuth issuer mismatch", "callback_issuer"],
      ["INVALID_CALLBACK_REQUEST", "callback_request"],
      ["No callback URL found", "callback_destination"],
      ["unable_to_create_session", "account_session"],
      ["signup_disabled", "account_signup"],
      [
        'Provider "github" did not return an email. Either request the provider\'s email scope, or create a placeholder via `mapProfileToUser`. See https://www.better-auth.com/docs/concepts/oauth#handling-providers-without-email',
        "missing_email",
      ],
    ]) {
      authLibraryDiagnostic("error", message, { private: "private-marker" });
      assert.equal(messages.at(-1)?.[1], category);
    }
    authCallbackDiagnostic("issuer_mismatch");
    assert.equal(messages.at(-1)?.[1], "callback_issuer");
    authCallbackDiagnostic("private-marker");
    assert.equal(messages.at(-1)?.[1], "callback_redirect_unknown");
    authCallbackDiagnostic(null);
    assert.equal(messages.at(-1)?.[1], "callback_response");
    assert.equal(JSON.stringify(messages).includes("private-marker"), false);
  } finally {
    console.error = original;
  }
});
