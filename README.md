# Zauber rate-quote agent

A take-home for the Zauber founding engineer role. The brief: rate-quote emails come in, an agent reads them, gets carrier prices, and replies. If the email is missing something it needs, the agent asks. Drafts the agent isn't sure about go to a human.

I built it the way I'd build a v0 at work. Cheap model where it can get away with it, better model where it can't, real validation on every LLM output, and a confidence score that's honest about when to hand off.

## The pipeline

```
email
  |
  v
[extract]       Haiku pulls origin, dest, weight, mode, customer, urgency.
  |             Forced tool use, Zod validates, no free-text path.
  v
[clarify]       If something's missing, ask one question, re-extract on reply.
  |             Max 3 turns. Stops as soon as the missing fields fill in.
  v
[retrieve]      pgvector cosine + Postgres BM25, fused with RRF.
  |             Plus a direct lookup for the customer profile if we got a name.
  v
[rates]         Mock carrier API. Maersk, Hapag-Lloyd, MSC.
  v
[draft]         Sonnet writes the reply with a self-reported confidence.
  v
[confidence]    Blend model confidence with 6 structural checks.
  v
  >= 0.75 -> auto-send eligible
  <  0.75 -> human review
```

## Why each piece is the way it is

**Extract uses Haiku** because it's a structured extraction task. Sonnet would be overkill and slow. The system prompt and tool schema are cached, and tool use is forced, so the model can't return prose. If Zod rejects the output the workflow fails loudly rather than guessing.

**Clarify reuses the same extractor.** Each turn the customer reply gets appended to the conversation and the whole thing goes back through `extractDetails`. That way fields answered in turn 1 don't get lost in turn 2. The tool schema only allows one question per turn, which keeps the agent from dumping a checklist on the customer.

One thing to call out: customer replies are pre-loaded in `src/run.ts` to simulate the back-and-forth. In production this is where you'd plug in an actual mailbox.

**Retrieve is hybrid on purpose.** Pure vector search misses exact-term lookups (customer names, port codes), pure BM25 misses paraphrases. RRF gives you both without tuning weights. I went with HNSW over IVFFlat because the corpus is small and HNSW doesn't need a training step, so `npm run init` can drop and rebuild the index without ceremony.

**Draft uses Sonnet** because this is the part the customer reads. Same caching trick on the system prompt and tool schema. The user message isn't cached because it's per-request.

**Confidence is not a model call.** It's the model's self-reported score averaged with a heuristic score. The heuristics are six independent yes/no checks:

1. Did the rates tool return three carriers?
2. Are the `validUntil` dates parseable?
3. Are they in the future?
4. Are all prices positive?
5. Does the draft mention all three carriers by name?
6. Did retrieval surface anything above 0.4 similarity?

Final confidence is `(self_reported + heuristic_fraction) / 2`. The 0.75 threshold for auto-send is a starting point, not a calibrated number. You'd want to tune it against a labelled set targeting ~95% auto-send precision before turning it on for real customers.

## Stack

Node 20, TypeScript, tsx for running without a build step. Anthropic SDK for Claude, OpenAI SDK only for embeddings (`text-embedding-3-small`). Postgres with pgvector in Docker. Zod on every LLM output. Langfuse for tracing. Vitest for the tests that matter.

## Observability

Every run produces a Langfuse trace called `rate_inquiry_workflow`. Inside it you'll see one generation per LLM call (extract, each clarify turn, draft) with token counts and cache hits, spans for retrieve and rates, and a `confidence` span with the per-heuristic breakdown so you can see *why* a draft scored where it did. Final confidence is logged as a queryable score.

If the email has prompt-injection markers, a `security_check` span gets added. It's logged, not blocked. A real system needs a classifier in front of extract.

## Setup

You need Node 20+, Docker, an Anthropic key, and an OpenAI key. Langfuse is optional but makes debugging much nicer.

```bash
npm install
docker compose up -d
cp .env.example .env   # fill in keys
npm run init           # create schema, build HNSW index
npm run embed          # embed the corpus (skips files whose hash hasn't changed)
```

## Running it

```bash
npm run agent <n>
```

| n | What it tests |
|---|---|
| 0 | Clean sea freight, all fields present |
| 1 | Missing weight, one clarification turn |
| 2 | Dangerous goods, repeat customer (tests retrieval) |
| 3 | Mode unclear, customer answers "sea freight" |
| 4 | Prompt injection followed by a real request |
| 5 | Air freight, missing weight, one turn |
| 6 | Missing origin and mode, two turns |

## Eval

```bash
npm run eval
```

Ten labelled cases in `evals/dataset.json`, checked against `status` and `missingFields`. Target is 8/10. If a change drops this, that's a regression even if the unit tests still pass. The eval is the contract; the unit tests are sanity checks.

## Code layout

```
src/
  steps/
    extract.ts       email -> structured fields
    clarify.ts       multi-turn ask loop
    retrieve.ts      pgvector + BM25 + RRF
    draft.ts         Sonnet reply with self-reported confidence
  infra/
    db.ts            pg pool + schema init
    observability.ts Langfuse client
    embed.ts         npm run embed
    init.ts          npm run init
    search.ts        dev utility for poking at the index
  tools/
    carrierRates.ts  mock carrier tool
  workflow.ts        orchestration + confidence blend
  run.ts             CLI / scenario runner
  types.ts
  models.ts

evals/               dataset + harness
tests/               unit tests
corpus/              markdown that gets embedded
```

## What I'd do next

A few things I left out on purpose, in roughly the order I'd tackle them:

- **Chunk the corpus.** Right now files are embedded whole. Semantic chunking around 500 tokens with parent-document retrieval would help a lot once the corpus grows past toy size.
- **Add a reranker.** RRF on top-20 is fine, but a cross-encoder rerank on those 20 would lift precision noticeably for the cost of one extra call.
- **Block the injection, don't just log it.** A small classifier in front of extract is the obvious fix.
- **Real carrier integrations.** The mock returns three quotes happily. Real TMS APIs have auth, rate limits, partial failures, and very different schemas.
- **Calibrate the 0.75 threshold** against a labelled set before trusting auto-send in production.
- **Language detection** on the inbound email. Non-English will degrade extraction silently otherwise.

Cost per run prints to the CLI and also flows into Langfuse, so it's easy to see which scenarios are expensive (clarify turns add up).