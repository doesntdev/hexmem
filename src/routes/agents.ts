import type { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';
import { getAuth } from '../services/auth.js';
import type { Agent } from '../types/index.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/agents — create agent
    app.post('/api/v1/agents', async (request, reply) => {
        const { slug, display_name, description, core_memory, config } = request.body as {
            slug: string;
            display_name: string;
            description?: string;
            core_memory?: Record<string, unknown>;
            config?: Record<string, unknown>;
        };

        if (!slug || !display_name) {
            return reply.code(400).send({ error: 'slug and display_name are required' });
        }

        // Validate slug format
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug)) {
            return reply.code(400).send({
                error: 'slug must be lowercase alphanumeric with hyphens/underscores, starting with a letter or number',
            });
        }

        try {
            const { rows } = await query<Agent>(
                `INSERT INTO agents (slug, display_name, description, core_memory, config)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
                [slug, display_name, description || null, core_memory || {}, config || {}]
            );
            return reply.code(201).send(rows[0]);
        } catch (err: unknown) {
            const pgErr = err as { code?: string };
            if (pgErr.code === '23505') {
                return reply.code(409).send({ error: `Agent with slug '${slug}' already exists` });
            }
            throw err;
        }
    });

    // GET /api/v1/agents — list agents
    app.get('/api/v1/agents', async (_request, reply) => {
        const { rows } = await query<Agent>(
            'SELECT * FROM agents ORDER BY created_at ASC'
        );
        return reply.send({ agents: rows, total: rows.length });
    });

    // GET /api/v1/agents/:id — get agent by ID or slug
    app.get('/api/v1/agents/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        // Try UUID first, then slug
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const { rows } = await query<Agent>(
            isUuid
                ? 'SELECT * FROM agents WHERE id = $1'
                : 'SELECT * FROM agents WHERE slug = $1',
            [id]
        );

        if (rows.length === 0) {
            return reply.code(404).send({ error: 'Agent not found' });
        }

        // Include stats
        const agent = rows[0];
        const stats = await getAgentStats(agent.id);

        return reply.send({ ...agent, stats });
    });

    // PATCH /api/v1/agents/:id — update agent
    app.patch('/api/v1/agents/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const updates = request.body as Partial<{
            display_name: string;
            description: string;
            config: Record<string, unknown>;
        }>;

        const setClauses: string[] = [];
        const values: unknown[] = [];
        let paramIdx = 1;

        if (updates.display_name !== undefined) {
            setClauses.push(`display_name = $${paramIdx++}`);
            values.push(updates.display_name);
        }
        if (updates.description !== undefined) {
            setClauses.push(`description = $${paramIdx++}`);
            values.push(updates.description);
        }
        if (updates.config !== undefined) {
            setClauses.push(`config = $${paramIdx++}`);
            values.push(updates.config);
        }

        if (setClauses.length === 0) {
            return reply.code(400).send({ error: 'No valid fields to update' });
        }

        const isUuid = /^[0-9a-f]{8}-/i.test(id);
        const whereClause = isUuid ? `id = $${paramIdx}` : `slug = $${paramIdx}`;
        values.push(id);

        const { rows } = await query<Agent>(
            `UPDATE agents SET ${setClauses.join(', ')} WHERE ${whereClause} RETURNING *`,
            values
        );

        if (rows.length === 0) {
            return reply.code(404).send({ error: 'Agent not found' });
        }

        return reply.send(rows[0]);
    });

    // PATCH /api/v1/agents/:id/core-memory — JSON merge patch on core_memory
    app.patch('/api/v1/agents/:id/core-memory', async (request, reply) => {
        const { id } = request.params as { id: string };
        const patch = request.body as Record<string, unknown>;

        if (!patch || typeof patch !== 'object') {
            return reply.code(400).send({ error: 'Request body must be a JSON object' });
        }

        const isUuid = /^[0-9a-f]{8}-/i.test(id);
        const whereField = isUuid ? 'id' : 'slug';

        // Use jsonb_strip_nulls to remove null keys (allows deletion)
        const { rows } = await query<Agent>(
            `UPDATE agents
       SET core_memory = jsonb_strip_nulls(core_memory || $1::jsonb)
       WHERE ${whereField} = $2
       RETURNING *`,
            [JSON.stringify(patch), id]
        );

        if (rows.length === 0) {
            return reply.code(404).send({ error: 'Agent not found' });
        }

        return reply.send({ core_memory: rows[0].core_memory });
    });
}

async function getAgentStats(agentId: string): Promise<Record<string, number>> {
    const tables = ['sessions', 'tasks', 'facts', 'decisions', 'events', 'projects'];
    const stats: Record<string, number> = {};

    for (const table of tables) {
        const { rows } = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM ${table} WHERE agent_id = $1`,
            [agentId]
        );
        stats[table] = parseInt(rows[0].count, 10);
    }

    return stats;
}
