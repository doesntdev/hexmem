import type { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';

/**
 * Memory edge routes — manual CRUD for the relationship graph.
 * Auto-extracted edges are already created during session message ingest.
 */
export async function edgeRoutes(app: FastifyInstance): Promise<void> {

    // Create an edge between two memory items
    app.post('/api/v1/edges', async (request, reply) => {
        const { agent_id, source_type, source_id, target_type, target_id, relation, weight, metadata } = request.body as {
            agent_id: string; source_type: string; source_id: string;
            target_type: string; target_id: string; relation: string;
            weight?: number; metadata?: Record<string, unknown>;
        };

        if (!agent_id || !source_type || !source_id || !target_type || !target_id || !relation) {
            return reply.code(400).send({ error: 'agent_id, source_type, source_id, target_type, target_id, and relation are required' });
        }

        try {
            const { rows } = await query(
                `INSERT INTO memory_edges (agent_id, source_type, source_id, target_type, target_id, relation, weight, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source_type, source_id, target_type, target_id, relation) DO UPDATE
           SET weight = EXCLUDED.weight, metadata = EXCLUDED.metadata
         RETURNING *`,
                [agent_id, source_type, source_id, target_type, target_id, relation,
                    weight ?? 1.0, metadata || {}]
            );
            return reply.code(201).send(rows[0]);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return reply.code(400).send({ error: msg });
        }
    });

    // List edges for a specific memory item (outgoing + incoming)
    app.get('/api/v1/edges', async (request, reply) => {
        const { agent_id, source_type, source_id, target_type, target_id, relation, limit, offset } = request.query as {
            agent_id?: string; source_type?: string; source_id?: string;
            target_type?: string; target_id?: string; relation?: string;
            limit?: string; offset?: string;
        };
        const lim = Math.min(parseInt(limit || '50', 10), 100);
        const off = parseInt(offset || '0', 10);

        let sql = 'SELECT * FROM memory_edges WHERE 1=1';
        const params: unknown[] = [];
        let idx = 1;
        if (agent_id) { sql += ` AND agent_id = $${idx++}`; params.push(agent_id); }
        if (source_type) { sql += ` AND source_type = $${idx++}`; params.push(source_type); }
        if (source_id) { sql += ` AND source_id = $${idx++}`; params.push(source_id); }
        if (target_type) { sql += ` AND target_type = $${idx++}`; params.push(target_type); }
        if (target_id) { sql += ` AND target_id = $${idx++}`; params.push(target_id); }
        if (relation) { sql += ` AND relation = $${idx++}`; params.push(relation); }
        sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(lim, off);

        const { rows } = await query(sql, params);
        return reply.send({ edges: rows, total: rows.length });
    });

    // Get all edges for a specific item (both directions)
    app.get('/api/v1/edges/graph/:type/:id', async (request, reply) => {
        const { type, id } = request.params as { type: string; id: string };
        const { agent_id } = request.query as { agent_id?: string };

        const agentFilter = agent_id ? 'AND agent_id = $3' : '';
        const params: unknown[] = [type, id];
        if (agent_id) params.push(agent_id);

        // Get outgoing edges
        const { rows: outgoing } = await query(
            `SELECT *, 'outgoing' as direction FROM memory_edges
       WHERE source_type = $1 AND source_id = $2 ${agentFilter}`,
            params
        );

        // Get incoming edges
        const { rows: incoming } = await query(
            `SELECT *, 'incoming' as direction FROM memory_edges
       WHERE target_type = $1 AND target_id = $2 ${agentFilter}`,
            params
        );

        return reply.send({
            node: { type, id },
            outgoing,
            incoming,
            total: outgoing.length + incoming.length,
        });
    });

    // Delete an edge
    app.delete('/api/v1/edges/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('DELETE FROM memory_edges WHERE id = $1 RETURNING id', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Edge not found' });
        return reply.code(204).send();
    });
}
