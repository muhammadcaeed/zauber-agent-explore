# Zauber Rate-Quote Workflow

A deterministic LLM workflow that handles freight rate-quote emails end-to-end: extracts shipment details, retrieves relevant context, fetches carrier rates, and drafts a reply — with a confidence score that decides whether to auto-send or route to human review.

## Why workflow, not agent

This is a **workflow** (fixed pipeline) not a free-form agent. Anthropic's own [Building effective agents](https://www.anthropic.com/research/building-effective-agents) guidance recommends workflows over agents when the task has a known, predictable structure — which rate quoting does. An open-ended agent loop adds latency and unpredictability without improving the outcome here.

## Architecture

```
email
  │
  ▼
[extract]          Claude Haiku — tool use, forced schema
  │                Zod validates output at runtime
  │                Prompt caching on system + tool schema
  ▼
[gate]             Block if required fields missing → ask clarification
  │
  ▼
[retrieve]         pgvector cosine similarity search
  │                Corpus: SOPs, past quotes, customer profiles
  ▼
[rates_tool]       Mock carrier API (Maersk, Hapag-Lloyd, MSC)
  │                Real integration would hit carrier TMS/rate APIs
  ▼
[draft]            Claude Sonnet — tool use, forced schema
  │                Zod validates output at runtime
  │                Prompt caching on system + tool schema
  ▼
[confidence]       Blend: LLM self-reported (0–1) + structural heuristics (0–1)
  │                Structural: rate count, validity dates, price sanity, carrier mentions
  ▼
auto-send          confidence ≥ 0.75
  OR
human review       confidence < 0.75
```

## Observability

Every run produces a Langfuse trace with:
- `extract` generation — model, token usage, cache hits, structured output
- `retrieve` span — query, similarity hits
- `rates_tool` span — carrier count
- `draft` generation — model, token usage, confidence
- `confidence` span — per-check heuristic breakdown
- Final `final_confidence` score for filtering runs in Langfuse

## Requirements

1. Node.js 20+
2. Docker and Docker Compose
3. OpenAI API key (embeddings)
4. Anthropic API key (extract + draft)
5. Langfuse keys (observability — optional but recommended)

## Setup

```bash
npm install
docker compose up -d
cp .env.example .env   # fill in API keys
npm run init           # creates pgvector schema
npm run embed          # ingests corpus/
```

## Run

```bash
npm run agent 0        # clean sea freight case
npm run agent 1        # missing weight → clarification
npm run agent 2        # repeat customer, dangerous goods
npm run agent 3        # vague email → clarification
npm run agent 4        # mode unclear
npm run agent 5        # prompt injection attempt
```

## Eval

```bash
npm run eval
```

Runs 10 labelled cases and reports pass rate. Checks `status`, `missingFields`. Target: ≥ 8/10 before delivery.

## Known limitations and future work

- **Chunking**: corpus files embedded whole. At scale: semantic chunking (~500 tokens, sentence boundary) + parent-doc retrieval.
- **Hybrid search**: pure vector search misses exact-match keywords (e.g. customer name). Production: tsvector BM25 + pgvector RRF fusion.
- **Reranker**: cross-encoder rerank of top-20 → top-3 would improve retrieval precision.
- **Multi-language**: no language detection. Customer emails in French/Chinese would degrade extraction.
- **Prompt injection**: injection markers are flagged in Langfuse but not blocked. Production needs a classifier guardrail.
- **Idempotency**: re-running `npm run embed` truncates and re-inserts. Production: content-hash upsert.
- **Carrier API**: rates are mocked. Real integration would call carrier TMS APIs with auth, rate-request schemas, and SLA guarantees.
- **Confidence calibration**: `AUTO_SEND_THRESHOLD = 0.75` is a reasonable starting point. Should be calibrated against a labelled eval set targeting 95% precision on auto-sends.
- **Cost tracking**: token usage flows to Langfuse per generation. Aggregate cost per run is visible in the Langfuse dashboard.
