/*
 * All model identifiers and tunable constants live here. Changing a model anywhere
 * in the codebase means changing it here. If the embedding model changes, the
 * entire corpus must be re-embedded before retrieval will work correctly.
 */

export const MODELS = {
  extract: "claude-haiku-4-5-20251001",
  draft: "claude-sonnet-4-6",
  embedding: "text-embedding-3-small",
} as const;
