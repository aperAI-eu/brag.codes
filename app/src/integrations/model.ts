export type IntegrationView = {
  version: number;
  storage_ready: boolean;
  enabled: boolean;
  distill_origin: string;
  claude_model: string;
  distill_token_saved: boolean;
  anthropic_key_saved: boolean;
  updated_at: string | null;
  updated_by: string | null;
};
export type IntegrationInput = {
  expected_version: number;
  enabled: boolean;
  distill_origin: string;
  claude_model: string;
  distill_token?: string | null;
  anthropic_key?: string | null;
};
