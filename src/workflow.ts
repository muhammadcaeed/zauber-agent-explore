import { extractDetails } from "./extract.js";
import { retrieveRelevant } from "./retrieve.js";
import { getCarrierRates } from "./tools/carrierRates.js";
import { draftReply } from "./draft.js";
import { clarificationAgent } from "./clarify.js";
import { langfuse } from "./observability.js";
import type { LangfuseTraceClient } from "langfuse";
import type { AgentResult, TokenBucket, TraceStep } from "./types.js";

// Confidence below this threshold routes to human review.
// Target: 95% precision on auto-sends (calibrate against eval set as it grows).
const AUTO_SEND_THRESHOLD = 0.75;

// Cheap pre-flight check for obvious prompt-injection attempts.
// Logs a warning to Langfuse but does not block — blocking would require
// a separate classifier to avoid false positives on legitimate emails.
const INJECTION_PATTERN =
  /ignore (previous|prior|above|all)|system prompt|forget your instructions|jailbreak/i;

export async function handleRateInquiry(
  emailText: string,
  followUpReplies: string[] = []
): Promise<AgentResult> {
  const trace: TraceStep[] = [];
  const t0 = Date.now();

  const tokenUsage = {
    haiku: { inputTokens: 0, outputTokens: 0 } satisfies TokenBucket,
    sonnet: { inputTokens: 0, outputTokens: 0 } satisfies TokenBucket,
  };

  let agentTurns: number | undefined;

  const lfTrace = langfuse.trace({
    name: "rate_inquiry_workflow",
    input: { emailText },
    metadata: { workflowVersion: "v1" },
  });

  if (INJECTION_PATTERN.test(emailText)) {
    lfTrace.span({ name: "security_check" }).end({
      output: { warning: "potential prompt injection markers detected in email" },
    });
  }

  // Wraps non-LLM steps (retrieve, rates_tool, clarify) with Langfuse span + trace entry.
  // LLM steps (extract, draft) manage their own generations inside the function.
  async function timed<T>(
    step: string,
    fn: () => Promise<{ result: T; details?: Record<string, unknown> }>
  ): Promise<T> {
    const span = lfTrace.span({ name: step });
    const start = Date.now();
    try {
      const { result, details } = await fn();
      trace.push({
        step,
        durationMs: Date.now() - start,
        ...(details !== undefined ? { details } : {}),
      });
      span.end({ output: result });
      return result;
    } catch (err) {
      trace.push({
        step,
        durationMs: Date.now() - start,
        details: { error: String(err) },
      });
      span.end({ output: { error: String(err) }, level: "ERROR" });
      throw err;
    }
  }

  async function timedLlm<T>(
    step: string,
    fn: (lfTrace: LangfuseTraceClient) => Promise<T>,
    details: (result: T) => Record<string, unknown>
  ): Promise<T> {
    const start = Date.now();
    const result = await fn(lfTrace);
    trace.push({ step, durationMs: Date.now() - start, details: details(result) });
    return result;
  }

  try {
    // 1. Extract structured fields from the email
    let extracted = await timedLlm(
      "extract",
      (t) =>
        extractDetails(emailText, t, (u) => {
          tokenUsage.haiku.inputTokens += u.inputTokens;
          tokenUsage.haiku.outputTokens += u.outputTokens;
        }),
      (r) => ({ ...r })
    );

    // 2. Gate: run clarification agent if required fields are missing.
    //    With no followUpReplies the agent asks once and returns needs_clarification —
    //    identical behaviour to the previous static gate.
    if (extracted.missingFields.length > 0) {
      const { extraction, turns, lastQuestion } = await timed("clarify", () =>
        clarificationAgent(emailText, extracted, followUpReplies, {
          maxTurns: 3,
          onUsage: (u) => {
            tokenUsage.haiku.inputTokens += u.inputTokens;
            tokenUsage.haiku.outputTokens += u.outputTokens;
          },
          lfTrace,
        }).then((r) => ({
          result: r,
          details: { turns: r.turns, resolved: r.lastQuestion === null },
        }))
      );

      if (lastQuestion !== null) {
        const result: AgentResult = {
          status: "needs_clarification",
          clarificationQuestion: lastQuestion,
          clarificationTurns: turns,
          trace,
          tokenUsage,
          reasoning: `Missing after ${turns} turn(s): ${extraction.missingFields.join(", ")}`,
        };
        lfTrace.update({ output: result });
        await langfuse.flushAsync();
        return result;
      }

      extracted = extraction;
      agentTurns = turns;
    }

    // 3. Retrieve: semantic + BM25 hybrid search, plus a targeted customer-profile
    //    lookup when the customer name is known. Both run in parallel.
    const retrievalQuery = `${extracted.origin} to ${extracted.destination} ${extracted.mode} ${extracted.customer ?? ""} freight`;
    const context = await timed("retrieve", async () => {
      const [general, customerProfile] = await Promise.all([
        retrieveRelevant(retrievalQuery, 4),
        extracted.customer
          ? retrieveRelevant(extracted.customer, 1, { docType: "customer_profile" })
          : Promise.resolve([]),
      ]);

      const seen = new Set<string>();
      const merged = [...customerProfile, ...general]
        .filter((d) => {
          if (seen.has(d.title)) return false;
          seen.add(d.title);
          return true;
        })
        .slice(0, 4);

      return {
        result: merged,
        details: {
          query: retrievalQuery,
          customerProfileFetched: customerProfile.length > 0,
          hits: merged.map((c) => ({
            title: c.title,
            rrfScore: c.rrfScore,
            similarity: c.similarity,
          })),
        },
      };
    });

    // 4. Fetch live carrier rates (mock; real integration would hit carrier APIs)
    const rates = await timed("rates_tool", async () => {
      const result = await getCarrierRates({
        origin: extracted.origin!,
        destination: extracted.destination!,
        weightKg: extracted.weightKg!,
        mode: extracted.mode!,
      });
      return { result, details: { rateCount: result.length } };
    });

    // 5. Draft reply
    const draft = await timedLlm(
      "draft",
      (t) =>
        draftReply(emailText, rates, context, t, (u) => {
          tokenUsage.sonnet.inputTokens += u.inputTokens;
          tokenUsage.sonnet.outputTokens += u.outputTokens;
        }),
      (r) => ({ confidenceSelfReported: r.selfReportedConfidence })
    );

    // 6. Blend LLM self-reported confidence with structural heuristics.
    // Structural checks are harder to game than output-text regex matching.
    const heuristicChecks = {
      rateCountMatchesCarriers: rates.length === 3,
      validUntilParseable: rates.every((r) => !isNaN(Date.parse(r.validUntil))),
      validUntilFuture: rates.every((r) => new Date(r.validUntil) > new Date()),
      pricesPositive: rates.every((r) => r.priceEur > 0),
      draftMentionsAllCarriers: rates.every((r) => draft.draftReply.includes(r.carrier)),
      retrievalGotRelevant: context.some((c) => c.similarity > 0.4),
    };
    const heuristicScore =
      Object.values(heuristicChecks).filter(Boolean).length /
      Object.values(heuristicChecks).length;
    const finalConfidence = (draft.selfReportedConfidence + heuristicScore) / 2;
    const needsHumanReview = finalConfidence < AUTO_SEND_THRESHOLD;

    trace.push({
      step: "confidence",
      durationMs: 0,
      details: { heuristicChecks, heuristicScore, finalConfidence },
    });

    lfTrace.score({
      name: "final_confidence",
      value: finalConfidence,
      comment: needsHumanReview ? "below threshold, needs review" : "auto-send eligible",
    });

    const result: AgentResult = {
      status: "drafted",
      draftReply: draft.draftReply,
      ...(agentTurns !== undefined ? { clarificationTurns: agentTurns } : {}),
      confidence: finalConfidence,
      needsHumanReview,
      reasoning: draft.reasoning,
      trace,
      tokenUsage,
    };
    lfTrace.update({ output: result });
    await langfuse.flushAsync();
    return result;
  } catch (err) {
    trace.push({
      step: "error",
      durationMs: Date.now() - t0,
      details: { error: String(err) },
    });
    const result: AgentResult = {
      status: "failed",
      trace,
      tokenUsage,
      reasoning: String(err),
    };
    lfTrace.update({ output: result });
    await langfuse.flushAsync();
    return result;
  }
}
