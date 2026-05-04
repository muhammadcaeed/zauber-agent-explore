import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
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
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `)

    await pool.query(`
        CREATE INDEX IF NOT EXISTS documents_embedding_idx
        ON documents USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 10)
    `)
}