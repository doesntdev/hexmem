import type { FastifyInstance } from 'fastify';
import { query as dbQuery } from '../db/connection.js';

/**
 * Fastify plugin that logs API queries to the query_log table.
 * Captures endpoint, query text (from body), result count, and latency.
 */
export async function queryLogPlugin(app: FastifyInstance): Promise<void> {
    // Track endpoints that involve search/recall queries
    const TRACKED_ENDPOINTS = new Set([
        '/api/v1/search', '/api/v1/recall',
    ]);

    app.addHook('onResponse', async (request, reply) => {
        const url = request.url.split('?')[0];
        if (!TRACKED_ENDPOINTS.has(url)) return;
        if (request.method !== 'POST') return;

        try {
            const body = request.body as Record<string, unknown> | null;
            const queryText = body?.query as string | undefined;
            const agentId = body?.agent_id as string | undefined;
            const latencyMs = reply.elapsedTime;

            // Get result count from response if available
            // We can't easily read the response body in onResponse,
            // so we'll just log what we have.
            await dbQuery(
                `INSERT INTO query_log (agent_id, endpoint, query_text, latency_ms, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
                [
                    agentId || null,
                    url,
                    queryText || null,
                    latencyMs,
                    JSON.stringify({
                        method: request.method,
                        status_code: reply.statusCode,
                    }),
                ]
            );
        } catch {
            // Silently fail — logging should never break the request
        }
    });
}

/**
 * Analytics routes for query log data.
 */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
    // GET /api/v1/analytics/queries — query log summary
    app.get('/api/v1/analytics/queries', async (request, reply) => {
        const { agent_id, limit, since } = request.query as {
            agent_id?: string; limit?: string; since?: string;
        };

        const lim = Math.min(parseInt(limit || '50', 10), 200);
        const params: unknown[] = [];
        let paramIdx = 1;
        const conditions: string[] = [];

        if (agent_id) {
            conditions.push(`agent_id = $${paramIdx++}`);
            params.push(agent_id);
        }
        if (since) {
            conditions.push(`created_at >= $${paramIdx++}`);
            params.push(since);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Recent queries
        const { rows: recent } = await dbQuery(
            `SELECT id, agent_id, endpoint, query_text, result_count, latency_ms, created_at
       FROM query_log ${where}
       ORDER BY created_at DESC LIMIT $${paramIdx}`,
            [...params, lim]
        );

        // Summary stats
        const { rows: stats } = await dbQuery(
            `SELECT
         endpoint,
         COUNT(*) as total_queries,
         ROUND(AVG(latency_ms)::numeric, 1) as avg_latency_ms,
         ROUND(MAX(latency_ms)::numeric, 1) as max_latency_ms,
         MIN(created_at) as first_query,
         MAX(created_at) as last_query
       FROM query_log ${where}
       GROUP BY endpoint
       ORDER BY total_queries DESC`,
            params
        );

        return reply.send({ recent, stats, total: recent.length });
    });
}
