import OpenAI from 'openai';
import { pool } from '../infra/db.js';
import { MODELS } from '../models.js';

const openai = new OpenAI({ maxRetries: 3 });

export type RetrievedDoc = {
  title: string;
  docType: string;
  content: string;
  similarity: number;
  rrfScore: number;
};

export type RetrieveFilter = {
  docType?: string;
};

// Hybrid retrieval: pgvector cosine similarity + Postgres BM25 (tsvector),
// fused with Reciprocal Rank Fusion (k=60). Neither source dominates —
// vector wins on semantic similarity, BM25 wins on exact-term matches
// (e.g. customer name, port code). Both run against the same candidate pool (20).
export async function retrieveRelevant(
  query: string,
  k = 3,
  filter?: RetrieveFilter
): Promise<RetrievedDoc[]> {
  const emb = await openai.embeddings.create({
    model: MODELS.embedding,
    input: query
  });

  const vector = emb.data[0]?.embedding;
  if (!vector) throw new Error("No embedding returned from OpenAI");
  const embStr = `[${vector.join(",")}]`;

  // $1 = vector, $2 = text query, $3 = docType filter (null = no filter), $4 = k
  const r = await pool.query(
    `WITH vector_results AS (
       SELECT id,
              ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS vector_rank,
              1 - (embedding <=> $1::vector) AS similarity
       FROM documents
       WHERE ($3::text IS NULL OR doc_type = $3)
       ORDER BY embedding <=> $1::vector
       LIMIT 20
     ),
     bm25_results AS (
       SELECT id,
              ROW_NUMBER() OVER (
                ORDER BY ts_rank(content_tsv, plainto_tsquery('english', $2)) DESC
              ) AS bm25_rank
       FROM documents
       WHERE content_tsv @@ plainto_tsquery('english', $2)
         AND ($3::text IS NULL OR doc_type = $3)
       ORDER BY ts_rank(content_tsv, plainto_tsquery('english', $2)) DESC
       LIMIT 20
     ),
     fused AS (
       SELECT
         COALESCE(v.id, b.id) AS id,
         COALESCE(1.0 / (60 + v.vector_rank), 0) +
           COALESCE(1.0 / (60 + b.bm25_rank), 0) AS rrf_score,
         COALESCE(v.similarity, 0) AS similarity
       FROM vector_results v
       FULL OUTER JOIN bm25_results b ON v.id = b.id
     )
     SELECT d.title, d.doc_type, d.content, f.similarity, f.rrf_score
     FROM fused f
     JOIN documents d ON f.id = d.id
     ORDER BY f.rrf_score DESC
     LIMIT $4`,
    [embStr, query, filter?.docType ?? null, k]
  );

  // pg returns numeric columns as strings; parseFloat converts to JS number
  return r.rows.map((row) => ({
    title: row.title as string,
    docType: row.doc_type as string,
    content: row.content as string,
    similarity: parseFloat(row.similarity),
    rrfScore: parseFloat(row.rrf_score),
  }));
}
