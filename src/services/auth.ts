import { randomBytes, createHash } from 'crypto';
import { query } from '../db/connection.js';
import { getConfig } from '../config.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthContext, ApiKey } from '../types/index.js';

const KEY_PREFIX = 'hxm_';
const KEY_LENGTH = 32; // 32 random hex chars after prefix

/**
 * Generate a new API key.
 * Returns the raw key (shown once) and metadata for storage.
 */
export function generateRawKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
    const random = randomBytes(KEY_LENGTH).toString('hex').slice(0, KEY_LENGTH);
    const rawKey = `${KEY_PREFIX}${random}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 8);
    return { rawKey, keyHash, keyPrefix };
}

/**
 * Hash an API key for comparison.
 */
export function hashKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Create and persist a new API key.
 */
export async function createApiKey(opts: {
    name: string;
    agentId?: string | null;
    permissions?: string[];
    rateLimit?: number;
    expiresAt?: Date | null;
}): Promise<{ key: string; id: string; prefix: string }> {
    const { rawKey, keyHash, keyPrefix } = generateRawKey();

    const { rows } = await query<{ id: string }>(
        `INSERT INTO api_keys (key_hash, key_prefix, name, agent_id, permissions, rate_limit, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
        [
            keyHash,
            keyPrefix,
            opts.name,
            opts.agentId || null,
            opts.permissions || ['read', 'write'],
            opts.rateLimit || 1000,
            opts.expiresAt || null,
        ]
    );

    return { key: rawKey, id: rows[0].id, prefix: keyPrefix };
}

/**
 * Verify an API key and return its auth context.
 */
export async function verifyApiKey(rawKey: string): Promise<AuthContext | null> {
    const keyHash = hashKey(rawKey);

    const { rows } = await query<ApiKey>(
        `SELECT id, agent_id, permissions, expires_at, revoked_at
     FROM api_keys
     WHERE key_hash = $1`,
        [keyHash]
    );

    if (rows.length === 0) return null;

    const key = rows[0];

    // Check revocation
    if (key.revoked_at) return null;

    // Check expiry
    if (key.expires_at && new Date(key.expires_at) < new Date()) return null;

    // Update last_used_at (fire and forget)
    query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [key.id]).catch(() => { });

    return {
        keyId: key.id,
        agentId: key.agent_id,
        permissions: key.permissions,
    };
}

/**
 * Fastify auth middleware.
 * Extracts Bearer token from Authorization header and verifies it.
 * In development mode, accepts HEXMEM_DEV_KEY as a bypass.
 */
export async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const config = getConfig();

    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.slice(7); // strip "Bearer "

    // Dev mode bypass
    if (config.nodeEnv === 'development' && config.devKey && token === config.devKey) {
        (request as FastifyRequest & { auth: AuthContext }).auth = {
            keyId: 'dev',
            agentId: null, // global access
            permissions: ['read', 'write', 'admin'],
        };
        return;
    }

    // Validate API key
    const auth = await verifyApiKey(token);
    if (!auth) {
        reply.code(401).send({ error: 'Invalid or expired API key' });
        return;
    }

    (request as FastifyRequest & { auth: AuthContext }).auth = auth;
}

/**
 * Helper to get auth context from request.
 */
export function getAuth(request: FastifyRequest): AuthContext {
    return (request as FastifyRequest & { auth: AuthContext }).auth;
}
