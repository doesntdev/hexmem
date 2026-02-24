import type { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';
import { createApiKey, getAuth } from '../services/auth.js';

export async function keyRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/keys — generate a new API key
    app.post('/api/v1/keys', async (request, reply) => {
        const { name, agent_id, permissions, rate_limit, expires_at } = request.body as {
            name: string;
            agent_id?: string;
            permissions?: string[];
            rate_limit?: number;
            expires_at?: string;
        };

        if (!name) {
            return reply.code(400).send({ error: 'name is required' });
        }

        const auth = getAuth(request);
        if (!auth.permissions.includes('admin') && !auth.permissions.includes('write')) {
            return reply.code(403).send({ error: 'Insufficient permissions to create API keys' });
        }

        const result = await createApiKey({
            name,
            agentId: agent_id,
            permissions,
            rateLimit: rate_limit,
            expiresAt: expires_at ? new Date(expires_at) : null,
        });

        // Return the raw key ONCE — it cannot be retrieved again
        return reply.code(201).send({
            id: result.id,
            key: result.key,
            prefix: result.prefix,
            name,
            message: 'Save this key now — it will not be shown again.',
        });
    });

    // GET /api/v1/keys — list keys (metadata only, never the full key)
    app.get('/api/v1/keys', async (_request, reply) => {
        const { rows } = await query(
            `SELECT id, key_prefix, name, agent_id, permissions, rate_limit,
              expires_at, last_used_at, created_at, revoked_at
       FROM api_keys
       ORDER BY created_at DESC`
        );
        return reply.send({ keys: rows, total: rows.length });
    });

    // DELETE /api/v1/keys/:id — revoke a key (soft delete)
    app.delete('/api/v1/keys/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const auth = getAuth(request);
        if (!auth.permissions.includes('admin') && !auth.permissions.includes('write')) {
            return reply.code(403).send({ error: 'Insufficient permissions to revoke API keys' });
        }

        const { rowCount } = await query(
            'UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
            [id]
        );

        if (rowCount === 0) {
            return reply.code(404).send({ error: 'Key not found or already revoked' });
        }

        return reply.send({ message: 'Key revoked successfully' });
    });
}
