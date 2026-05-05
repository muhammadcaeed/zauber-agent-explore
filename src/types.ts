export type ExtractedDetails = {
  origin: string | null;
  destination: string | null;
  weightKg: number | null;
  mode: "sea" | "air" | "road" | null;
  customer: string | null;
  urgency: "normal" | "urgent" | null;
  missingFields: string[];
};

export type TokenBucket = { inputTokens: number; outputTokens: number };

export type AgentResult = {
  status: "drafted" | "needs_clarification" | "failed";
  draftReply?: string;
  clarificationQuestion?: string;
  clarificationTurns?: number;
  confidence?: number;
  needsHumanReview?: boolean;
  reasoning?: string;
  trace: TraceStep[];
  tokenUsage?: {
    haiku: TokenBucket;
    sonnet: TokenBucket;
  };
};

export type TraceStep = {
  step: string;
  durationMs: number;
  details?: Record<string, unknown>;
};
