import type { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';
import { getEmbeddingProvider } from '../server.js';

/**
 * Unified `recall` endpoint — hybrid retrieval with:
 * 1. Semantic search (vector similarity)
 * 2. Keyword search (trigram)
 * 3. Recency boost
 * 4. 1-hop graph traversal for related items
 * 5. Reranking pipeline to merge and sort
 */

interface RecallResult {
    id: string;
    type: string;
    content: string;
    score: number;
    signals: {
        semantic?: number;
        keyword?: number;
        recency?: number;
        graph_boost?: number;
    };
    metadata: Record<string, unknown>;
    created_at: string;
    related?: RecallResult[];
}

// Table configs for recall queries
const RECALL_TABLES = [
    { table: 'session_messages', type: 'session_message', contentCol: 'content', timeCol: 'created_at' },
    { table: 'facts', type: 'fact', contentCol: 'content', timeCol: 'created_at' },
    { table: 'decisions', type: 'decision', contentCol: 'title', timeCol: 'created_at' },
    { table: 'tasks', type: 'task', contentCol: 'title', timeCol: 'created_at' },
    { table: 'events', type: 'event', contentCol: 'title', timeCol: 'occurred_at' },
] as const;

export async function recallRoutes(app: FastifyInstance): Promise<void> {

    app.post('/api/v1/recall', async (request, reply) => {
        const {
            query: queryText, agent_id, types, limit = 20,
            include_related = true, recency_weight = 0.1,
            semantic_weight = 0.7, keyword_weight = 0.2,
        } = request.body as {
            query: string; agent_id: string; types?: string[];
            limit?: number; include_related?: boolean;
            recency_weight?: number; semantic_weight?: number; keyword_weight?: number;
        };

        if (!queryText || !agent_id) {
            return reply.code(400).send({ error: 'query and agent_id are required' });
        }

        // Step 1: Embed the query
        const provider = getEmbeddingProvider();
        let queryEmbedding: string | null = null;
        if (provider) {
            try {
                const vec = await provider.embed(queryText);
                queryEmbedding = `[${vec.join(',')}]`;
            } catch {
                // Fall back to keyword-only
            }
        }

        // Step 2: Run hybrid retrieval across all selected tables
        const allResults: RecallResult[] = [];
        const tablesToSearch = RECALL_TABLES.filter(t =>
            !types || types.length === 0 || types.includes(t.type)
        );

        for (const { table, type, contentCol, timeCol } of tablesToSearch) {
            // Semantic search
            if (queryEmbedding) {
                const { rows: semanticRows } = await query<{
                    id: string; content: string; similarity: number;
                    created_at: string;
                }>(
                    `SELECT id, ${contentCol} as content,
                  1 - (embedding <=> $1::vector) as similarity,
                  ${timeCol} as created_at
           FROM ${table}
           WHERE agent_id = $2
             AND embedding IS NOT NULL
             AND decay_status = 'active'
           ORDER BY embedding <=> $1::vector
           LIMIT $3`,
                    [queryEmbedding, agent_id, limit]
                );

                for (const row of semanticRows) {
                    const existing = allResults.find(r => r.id === row.id);
                    if (existing) {
                        existing.signals.semantic = row.similarity;
                    } else {
                        allResults.push({
                            id: row.id, type, content: row.content,
                            score: 0,
                            signals: { semantic: row.similarity },
                            metadata: {},
                            created_at: row.created_at,
                        });
                    }
                }
            }

            // Keyword search (trigram)
            try {
                const { rows: keywordRows } = await query<{
                    id: string; content: string; sim: number;
                    created_at: string;
                }>(
                    `SELECT id, ${contentCol} as content,
                  similarity(${contentCol}, $1) as sim,
                  ${timeCol} as created_at
           FROM ${table}
           WHERE agent_id = $2
             AND decay_status = 'active'
             AND similarity(${contentCol}, $1) > 0.1
           ORDER BY sim DESC
           LIMIT $3`,
                    [queryText, agent_id, limit]
                );

                for (const row of keywordRows) {
                    const existing = allResults.find(r => r.id === row.id);
                    if (existing) {
                        existing.signals.keyword = row.sim;
                    } else {
                        allResults.push({
                            id: row.id, type, content: row.content,
                            score: 0,
                            signals: { keyword: row.sim },
                            metadata: {},
                            created_at: row.created_at,
                        });
                    }
                }
            } catch {
                // pg_trgm not available for this column
            }
        }

        // Step 3: Compute recency signal
        const now = Date.now();
        const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days
        for (const result of allResults) {
            const age = now - new Date(result.created_at).getTime();
            result.signals.recency = Math.max(0, 1 - (age / maxAge));
        }

        // Step 4: Rerank — weighted combination of all signals
        for (const result of allResults) {
            const s = result.signals;
            result.score =
                (s.semantic || 0) * semantic_weight +
                (s.keyword || 0) * keyword_weight +
                (s.recency || 0) * recency_weight +
                (s.graph_boost || 0) * 0.1;
        }

        // Sort by composite score
        allResults.sort((a, b) => b.score - a.score);
        const topResults = allResults.slice(0, limit);

        // Step 5: 1-hop graph traversal for related items
        if (include_related && topResults.length > 0) {
            for (const result of topResults.slice(0, 5)) { // Limit graph traversal to top 5
                result.related = await getRelatedItems(result.id, result.type, agent_id);
            }
        }

        // Step 6: Bump access counts for returned items
        for (const result of topResults) {
            const tableConfig = RECALL_TABLES.find(t => t.type === result.type);
            if (tableConfig) {
                await query(
                    `UPDATE ${tableConfig.table} SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1`,
                    [result.id]
                ).catch(() => { /* ignore */ });
            }
        }

        return reply.send({
            results: topResults,
            total: topResults.length,
            query: queryText,
            weights: { semantic: semantic_weight, keyword: keyword_weight, recency: recency_weight },
        });
    });
}

/**
 * 1-hop graph traversal: fetch items directly connected to a given node.
 */
async function getRelatedItems(
    itemId: string, itemType: string, agentId: string
): Promise<RecallResult[]> {
    // Get edges where this item is source or target
    const { rows: edges } = await query<{
        direction: string; related_type: string; related_id: string;
        relation: string; weight: number;
    }>(
        `SELECT 'outgoing' as direction, target_type as related_type, target_id as related_id, relation, weight
     FROM memory_edges
     WHERE source_type = $1 AND source_id = $2 AND agent_id = $3
     UNION ALL
     SELECT 'incoming' as direction, source_type as related_type, source_id as related_id, relation, weight
     FROM memory_edges
     WHERE target_type = $1 AND target_id = $2 AND agent_id = $3`,
        [itemType, itemId, agentId]
    );

    if (edges.length === 0) return [];

    // Fetch the actual content for each related item
    const related: RecallResult[] = [];
    for (const edge of edges) {
        const tableConfig = RECALL_TABLES.find(t => t.type === edge.related_type);
        if (!tableConfig) continue;

        const { rows } = await query<{ id: string; content: string; created_at: string }>(
            `SELECT id, ${tableConfig.contentCol} as content, ${tableConfig.timeCol} as created_at
       FROM ${tableConfig.table} WHERE id = $1`,
            [edge.related_id]
        );

        if (rows.length > 0) {
            related.push({
                id: rows[0].id,
                type: edge.related_type,
                content: rows[0].content,
                score: edge.weight,
                signals: { graph_boost: edge.weight },
                metadata: { relation: edge.relation, direction: edge.direction },
                created_at: rows[0].created_at,
            });
        }
    }

    return related;
}
