import type { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';
import { getEmbeddingProvider } from '../server.js';

interface SearchResult {
    id: string;
    type: 'session_message' | 'fact' | 'decision' | 'task' | 'event';
    content: string;
    similarity: number;
    metadata: Record<string, unknown>;
    created_at: Date;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/search — semantic search across all memory
    app.post('/api/v1/search', async (request, reply) => {
        const {
            query: searchQuery,
            agent_id,
            types,
            limit,
            threshold,
        } = request.body as {
            query: string;
            agent_id: string;
            types?: string[];
            limit?: number;
            threshold?: number;
        };

        if (!searchQuery || !agent_id) {
            return reply.code(400).send({ error: 'query and agent_id are required' });
        }

        const provider = getEmbeddingProvider();
        if (!provider) {
            return reply.code(503).send({ error: 'Embedding provider not configured' });
        }

        // Embed the search query
        let queryEmbedding: number[];
        try {
            queryEmbedding = await provider.embed(searchQuery);
        } catch (err) {
            return reply.code(500).send({ error: `Embedding failed: ${(err as Error).message}` });
        }

        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const maxResults = Math.min(limit || 20, 100);
        const minSimilarity = threshold || 0.3;

        // Search types to include
        const searchTypes = types || ['session_message', 'fact', 'decision', 'task', 'event'];

        const results: SearchResult[] = [];

        // Search session messages
        if (searchTypes.includes('session_message')) {
            const { rows } = await query<{
                id: string; content: string; similarity: number;
                role: string; session_id: string; created_at: Date;
            }>(
                `SELECT id, content, role, session_id, created_at,
                1 - (embedding <=> $1::vector) as similarity
         FROM session_messages
         WHERE agent_id = $2
           AND embedding IS NOT NULL
           AND decay_status = 'active'
           AND 1 - (embedding <=> $1::vector) > $3
         ORDER BY similarity DESC
         LIMIT $4`,
                [embeddingStr, agent_id, minSimilarity, maxResults]
            );

            results.push(...rows.map(r => ({
                id: r.id,
                type: 'session_message' as const,
                content: r.content,
                similarity: r.similarity,
                metadata: { role: r.role, session_id: r.session_id },
                created_at: r.created_at,
            })));
        }

        // Search facts
        if (searchTypes.includes('fact')) {
            const { rows } = await query<{
                id: string; content: string; similarity: number;
                subject: string | null; confidence: number;
                tags: string[]; created_at: Date;
            }>(
                `SELECT id, content, subject, confidence, tags, created_at,
                1 - (embedding <=> $1::vector) as similarity
         FROM facts
         WHERE agent_id = $2
           AND embedding IS NOT NULL
           AND decay_status = 'active'
           AND 1 - (embedding <=> $1::vector) > $3
         ORDER BY similarity DESC
         LIMIT $4`,
                [embeddingStr, agent_id, minSimilarity, maxResults]
            );

            results.push(...rows.map(r => ({
                id: r.id,
                type: 'fact' as const,
                content: r.content,
                similarity: r.similarity,
                metadata: { subject: r.subject, confidence: r.confidence, tags: r.tags },
                created_at: r.created_at,
            })));
        }

        // Search decisions
        if (searchTypes.includes('decision')) {
            const { rows } = await query<{
                id: string; title: string; decision: string; similarity: number;
                rationale: string; tags: string[]; created_at: Date;
            }>(
                `SELECT id, title, decision, rationale, tags, created_at,
                1 - (embedding <=> $1::vector) as similarity
         FROM decisions
         WHERE agent_id = $2
           AND embedding IS NOT NULL
           AND decay_status = 'active'
           AND 1 - (embedding <=> $1::vector) > $3
         ORDER BY similarity DESC
         LIMIT $4`,
                [embeddingStr, agent_id, minSimilarity, maxResults]
            );

            results.push(...rows.map(r => ({
                id: r.id,
                type: 'decision' as const,
                content: `${r.title}: ${r.decision}`,
                similarity: r.similarity,
                metadata: { title: r.title, rationale: r.rationale, tags: r.tags },
                created_at: r.created_at,
            })));
        }

        // Search tasks
        if (searchTypes.includes('task')) {
            const { rows } = await query<{
                id: string; title: string; description: string | null; similarity: number;
                status: string; priority: number; tags: string[]; created_at: Date;
            }>(
                `SELECT id, title, description, status, priority, tags, created_at,
                1 - (embedding <=> $1::vector) as similarity
         FROM tasks
         WHERE agent_id = $2
           AND embedding IS NOT NULL
           AND decay_status = 'active'
           AND 1 - (embedding <=> $1::vector) > $3
         ORDER BY similarity DESC
         LIMIT $4`,
                [embeddingStr, agent_id, minSimilarity, maxResults]
            );

            results.push(...rows.map(r => ({
                id: r.id,
                type: 'task' as const,
                content: r.title + (r.description ? `: ${r.description}` : ''),
                similarity: r.similarity,
                metadata: { title: r.title, status: r.status, priority: r.priority, tags: r.tags },
                created_at: r.created_at,
            })));
        }

        // Search events
        if (searchTypes.includes('event')) {
            const { rows } = await query<{
                id: string; title: string; description: string | null; similarity: number;
                event_type: string; severity: string; tags: string[]; created_at: Date;
                occurred_at: Date;
            }>(
                `SELECT id, title, description, event_type, severity, tags, occurred_at as created_at,
                1 - (embedding <=> $1::vector) as similarity
         FROM events
         WHERE agent_id = $2
           AND embedding IS NOT NULL
           AND decay_status = 'active'
           AND 1 - (embedding <=> $1::vector) > $3
         ORDER BY similarity DESC
         LIMIT $4`,
                [embeddingStr, agent_id, minSimilarity, maxResults]
            );

            results.push(...rows.map(r => ({
                id: r.id,
                type: 'event' as const,
                content: r.title + (r.description ? `: ${r.description}` : ''),
                similarity: r.similarity,
                metadata: { title: r.title, event_type: r.event_type, severity: r.severity, tags: r.tags },
                created_at: r.created_at,
            })));
        }

        // Sort all results by similarity and trim to limit
        results.sort((a, b) => b.similarity - a.similarity);
        const trimmed = results.slice(0, maxResults);

        // Bump access counts for returned items (fire and forget)
        for (const r of trimmed) {
            const table = r.type === 'session_message' ? 'session_messages'
                : r.type === 'fact' ? 'facts'
                    : r.type === 'decision' ? 'decisions'
                        : r.type === 'task' ? 'tasks'
                            : 'events';

            query(
                `UPDATE ${table} SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1`,
                [r.id]
            ).catch(() => { });
        }

        return reply.send({
            results: trimmed,
            total: trimmed.length,
            query: searchQuery,
            embedding_provider: provider.name,
        });
    });
}
