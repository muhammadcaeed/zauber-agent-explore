# Zauber Agent Explore

This project is an early exploration of retrieval over freight related documents using Postgres with pgvector and OpenAI embeddings.

## Current scope

The code initializes a `documents` table with a vector index, ingests markdown files from `corpus`, creates embeddings with `text-embedding-3-small`, and runs similarity search queries from `src/search.ts`.

The project is intentionally incomplete. It is published to capture the current direction and make iteration easier.

## Requirements

1. Node.js 20 or newer
2. Docker and Docker Compose
3. OpenAI API key
4. Optional Anthropic API key

## Setup

1. Install dependencies

   `npm install`

2. Start Postgres with pgvector

   `docker compose up -d`

3. Create environment file

   Copy `.env.example` to `.env` and fill in your keys.

4. Initialize database schema

   `npx tsx src/init.ts`

## Run ingestion and search

1. Ingest corpus files

   `npm run embed`

2. Run sample semantic searches

   `npx tsx src/search.ts`

## Notes

`package.json` includes `dev` and `ask` scripts that point to files not yet present in this repository. That is expected at this stage.
