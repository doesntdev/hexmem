import { query } from '../db/connection.js';
import { getEmbeddingProvider } from '../server.js';

/**
 * SimHash-based duplicate detection for structured memory items.
 *
 * Uses a two-stage approach:
 * 1. Fast trigram similarity check (pg_trgm) for syntactic similarity
 * 2. Vector cosine similarity for semantic similarity
 *
 * Returns the existing duplicate if found, or null if the item is unique.
 */

interface DuplicateMatch {
    id: string;
    similarity: number;
    type: 'syntactic' | 'semantic';
}

const CONTENT_COLUMN: Record<string, string> = {
    facts: 'content',
    decisions: 'title',
    tasks: 'title',
    events: 'title',
    session_messages: 'content',
};

const TRIGRAM_THRESHOLD = 0.6;  // pg_trgm similarity threshold
const SEMANTIC_THRESHOLD = 0.92; // Very high to avoid false positives

/**
 * Check if a new item is a duplicate of an existing item.
 * Stage 1: Trigram similarity (fast, syntactic)
 * Stage 2: If no trigram match, check semantic similarity via embedding
 */
export async function checkDuplicate(
    table: string,
    agentId: string,
    content: string
): Promise<DuplicateMatch | null> {
    const contentCol = CONTENT_COLUMN[table];
    if (!contentCol) return null;

    // Stage 1: Trigram similarity
    try {
        const { rows } = await query<{ id: string; similarity: number }>(
            `SELECT id, similarity(${contentCol}, $1) as similarity
       FROM ${table}
       WHERE agent_id = $2
         AND decay_status = 'active'
         AND similarity(${contentCol}, $1) > $3
       ORDER BY similarity DESC
       LIMIT 1`,
            [content, agentId, TRIGRAM_THRESHOLD]
        );

        if (rows.length > 0) {
            return { id: rows[0].id, similarity: rows[0].similarity, type: 'syntactic' };
        }
    } catch {
        // pg_trgm might not be configured for this column; skip
    }

    // Stage 2: Semantic similarity via embedding
    const provider = getEmbeddingProvider();
    if (!provider) return null;

    try {
        const embedding = await provider.embed(content);
        const embeddingStr = `[${embedding.join(',')}]`;

        const { rows } = await query<{ id: string; similarity: number }>(
            `SELECT id, 1 - (embedding <=> $1::vector) as similarity
       FROM ${table}
       WHERE agent_id = $2
         AND embedding IS NOT NULL
         AND decay_status = 'active'
         AND 1 - (embedding <=> $1::vector) > $3
       ORDER BY similarity DESC
       LIMIT 1`,
            [embeddingStr, agentId, SEMANTIC_THRESHOLD]
        );

        if (rows.length > 0) {
            return { id: rows[0].id, similarity: rows[0].similarity, type: 'semantic' };
        }
    } catch {
        // Embedding failed; skip semantic check
    }

    return null;
}
