import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
});

// Release connections cleanly on Ctrl-C so the process exits promptly.
process.on("SIGINT", () => {
  pool.end().finally(() => process.exit(0));
});

export async function initSchema() {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY,
            doc_type TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding vector(1536),
            metadata JSONB,
            content_hash TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Generated tsvector column for BM25 full-text search (idempotent — ADD COLUMN IF NOT EXISTS)
    await pool.query(`
        ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS content_tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
    `);

    await pool.query(`
        ALTER TABLE documents
        ADD COLUMN IF NOT EXISTS content_hash TEXT
    `);

    // Unique partial index on content_hash enables idempotent embedding runs
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS documents_content_hash_idx
        ON documents (content_hash)
        WHERE content_hash IS NOT NULL
    `);

    // hnsw has no training step and better recall than ivfflat on small corpora;
    // drop the old index unconditionally so re-running init upgrades in place.
    await pool.query(`DROP INDEX IF EXISTS documents_embedding_idx`);
    await pool.query(`
        CREATE INDEX documents_embedding_idx
        ON documents USING hnsw (embedding vector_cosine_ops)
    `);

    // GIN index for BM25 full-text search
    await pool.query(`
        CREATE INDEX IF NOT EXISTS documents_content_tsv_idx
        ON documents USING GIN (content_tsv)
    `);
}
