import { readCredentialVault } from "./config/vault.ts";
import { readRuntimeConfig } from "./config/runtime.ts";

// Next reports instrumentation errors without necessarily exiting its listener.
// Validate before importing the generated server so invalid configuration cannot
// leave a listening process that appears to have started successfully.
try {
  await readRuntimeConfig();
  await readCredentialVault();
  await import("../app/server.js");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Runtime startup failed");
  process.exitCode = 1;
}
