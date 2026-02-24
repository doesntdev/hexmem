import type { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';
import { getAuth } from '../services/auth.js';
import { getEmbeddingProvider } from '../server.js';
import { extractFromMessage } from '../services/extraction.js';
import { summarizeSession } from '../services/summarizer.js';
import type { Session, SessionMessage } from '../types/index.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/sessions — start a new session
    app.post('/api/v1/sessions', async (request, reply) => {
        const { agent_id, external_id, metadata } = request.body as {
            agent_id: string;
            external_id?: string;
            metadata?: Record<string, unknown>;
        };

        if (!agent_id) {
            return reply.code(400).send({ error: 'agent_id is required' });
        }

        // Verify agent exists
        const { rows: agents } = await query('SELECT id FROM agents WHERE id = $1', [agent_id]);
        if (agents.length === 0) {
            return reply.code(404).send({ error: 'Agent not found' });
        }

        const { rows } = await query<Session>(
            `INSERT INTO sessions (agent_id, external_id, metadata)
       VALUES ($1, $2, $3)
       RETURNING *`,
            [agent_id, external_id || null, metadata || {}]
        );

        return reply.code(201).send(rows[0]);
    });

    // GET /api/v1/sessions — list sessions for an agent
    app.get('/api/v1/sessions', async (request, reply) => {
        const { agent_id, limit, offset } = request.query as {
            agent_id?: string;
            limit?: string;
            offset?: string;
        };

        const lim = Math.min(parseInt(limit || '50', 10), 100);
        const off = parseInt(offset || '0', 10);

        let sql = 'SELECT * FROM sessions';
        const params: unknown[] = [];
        let paramIdx = 1;

        if (agent_id) {
            sql += ` WHERE agent_id = $${paramIdx++}`;
            params.push(agent_id);
        }

        sql += ` ORDER BY started_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(lim, off);

        const { rows } = await query<Session>(sql, params);

        // Get total count
        let countSql = 'SELECT COUNT(*) as count FROM sessions';
        const countParams: unknown[] = [];
        if (agent_id) {
            countSql += ' WHERE agent_id = $1';
            countParams.push(agent_id);
        }
        const { rows: countRows } = await query<{ count: string }>(countSql, countParams);

        return reply.send({
            sessions: rows,
            total: parseInt(countRows[0].count, 10),
            limit: lim,
            offset: off,
        });
    });

    // GET /api/v1/sessions/:id — get session with message count
    app.get('/api/v1/sessions/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const { rows } = await query<Session>(
            'SELECT * FROM sessions WHERE id = $1',
            [id]
        );

        if (rows.length === 0) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        const { rows: countRows } = await query<{ count: string }>(
            'SELECT COUNT(*) as count FROM session_messages WHERE session_id = $1',
            [id]
        );

        return reply.send({
            ...rows[0],
            message_count: parseInt(countRows[0].count, 10),
        });
    });

    // POST /api/v1/sessions/:id/messages — add a message (hot path)
    // This is the main ingest endpoint: embed → store → extract → store structured items
    app.post('/api/v1/sessions/:id/messages', async (request, reply) => {
        const { id: sessionId } = request.params as { id: string };
        const { role, content, metadata } = request.body as {
            role: 'user' | 'assistant' | 'system' | 'tool';
            content: string;
            metadata?: Record<string, unknown>;
        };

        if (!role || !content) {
            return reply.code(400).send({ error: 'role and content are required' });
        }

        // Verify session exists and get agent_id
        const { rows: sessions } = await query<Session>(
            'SELECT id, agent_id FROM sessions WHERE id = $1',
            [sessionId]
        );

        if (sessions.length === 0) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        const agentId = sessions[0].agent_id;

        // Step 1: Embed the message
        let embedding: number[] | null = null;
        const provider = getEmbeddingProvider();
        if (provider) {
            try {
                embedding = await provider.embed(content);
            } catch (err) {
                app.log.warn(`Embedding failed: ${(err as Error).message}`);
            }
        }

        // Step 2: Store the message
        const embeddingStr = embedding ? `[${embedding.join(',')}]` : null;
        const { rows: msgRows } = await query<SessionMessage>(
            `INSERT INTO session_messages (session_id, agent_id, role, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5::vector, $6)
       RETURNING id, session_id, agent_id, role, content, metadata, created_at`,
            [sessionId, agentId, role, content, embeddingStr, metadata || {}]
        );

        const message = msgRows[0];

        // Step 3: Inline extraction (facts, decisions, tasks, events)
        // Get recent context for better extraction
        const { rows: recentMsgs } = await query<{ role: string; content: string }>(
            `SELECT role, content FROM session_messages
       WHERE session_id = $1 AND id != $2
       ORDER BY created_at DESC LIMIT 4`,
            [sessionId, message.id]
        );

        const extracted = await extractFromMessage(
            { role, content },
            recentMsgs.reverse()
        );

        // Step 4: Store extracted items
        const storedItems = await storeExtractedItems(agentId, sessionId, extracted, provider);

        return reply.code(201).send({
            message,
            extracted: {
                facts: storedItems.factIds.length,
                decisions: storedItems.decisionIds.length,
                tasks: storedItems.taskIds.length,
                events: storedItems.eventIds.length,
            },
        });
    });

    // GET /api/v1/sessions/:id/messages — list messages in a session
    app.get('/api/v1/sessions/:id/messages', async (request, reply) => {
        const { id: sessionId } = request.params as { id: string };
        const { limit, offset } = request.query as { limit?: string; offset?: string };

        const lim = Math.min(parseInt(limit || '100', 10), 500);
        const off = parseInt(offset || '0', 10);

        const { rows } = await query<SessionMessage>(
            `SELECT id, session_id, agent_id, role, content, metadata, created_at
       FROM session_messages
       WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
            [sessionId, lim, off]
        );

        return reply.send({ messages: rows, total: rows.length });
    });

    // POST /api/v1/sessions/:id/end — end a session (triggers summarization)
    app.post('/api/v1/sessions/:id/end', async (request, reply) => {
        const { id: sessionId } = request.params as { id: string };

        const { rows } = await query<Session>(
            'SELECT * FROM sessions WHERE id = $1',
            [sessionId]
        );

        if (rows.length === 0) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        if (rows[0].ended_at) {
            return reply.code(400).send({ error: 'Session already ended' });
        }

        // Generate summary
        const summary = await summarizeSession(sessionId);

        // Mark session as ended
        const { rows: updated } = await query<Session>(
            `UPDATE sessions SET ended_at = NOW(), summary = COALESCE($1, summary)
       WHERE id = $2 RETURNING *`,
            [summary, sessionId]
        );

        return reply.send(updated[0]);
    });
}

// ---- Helper: Store extracted structured items ----

interface StoredItems {
    factIds: string[];
    decisionIds: string[];
    taskIds: string[];
    eventIds: string[];
}

import type { ExtractionResult } from '../services/extraction.js';
import type { EmbeddingProvider } from '../types/index.js';

async function storeExtractedItems(
    agentId: string,
    sessionId: string,
    extracted: ExtractionResult,
    embeddingProvider: EmbeddingProvider | null
): Promise<StoredItems> {
    const result: StoredItems = { factIds: [], decisionIds: [], taskIds: [], eventIds: [] };

    // Store facts
    for (const fact of extracted.facts) {
        let embedding: string | null = null;
        if (embeddingProvider) {
            try {
                const vec = await embeddingProvider.embed(fact.content);
                embedding = `[${vec.join(',')}]`;
            } catch { /* skip embedding */ }
        }

        const { rows } = await query<{ id: string }>(
            `INSERT INTO facts (agent_id, content, subject, confidence, source, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       RETURNING id`,
            [agentId, fact.content, fact.subject, fact.confidence,
                `session:${sessionId}`, fact.tags, embedding]
        );
        result.factIds.push(rows[0].id);

        // Create edge: fact → session
        await query(
            `INSERT INTO memory_edges (agent_id, source_type, source_id, target_type, target_id, relation)
       VALUES ($1, 'fact', $2, 'session', $3, 'derived_from')
       ON CONFLICT DO NOTHING`,
            [agentId, rows[0].id, sessionId]
        );
    }

    // Store decisions
    for (const dec of extracted.decisions) {
        let embedding: string | null = null;
        if (embeddingProvider) {
            try {
                const vec = await embeddingProvider.embed(`${dec.title}: ${dec.decision}`);
                embedding = `[${vec.join(',')}]`;
            } catch { /* skip */ }
        }

        const { rows } = await query<{ id: string }>(
            `INSERT INTO decisions (agent_id, title, decision, rationale, alternatives, session_id, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
       RETURNING id`,
            [agentId, dec.title, dec.decision, dec.rationale || null,
                JSON.stringify(dec.alternatives || []), sessionId, dec.tags, embedding]
        );
        result.decisionIds.push(rows[0].id);

        await query(
            `INSERT INTO memory_edges (agent_id, source_type, source_id, target_type, target_id, relation)
       VALUES ($1, 'decision', $2, 'session', $3, 'decided_in')
       ON CONFLICT DO NOTHING`,
            [agentId, rows[0].id, sessionId]
        );
    }

    // Store tasks
    for (const task of extracted.tasks) {
        let embedding: string | null = null;
        if (embeddingProvider) {
            try {
                const vec = await embeddingProvider.embed(task.title + (task.description ? `: ${task.description}` : ''));
                embedding = `[${vec.join(',')}]`;
            } catch { /* skip */ }
        }

        const { rows } = await query<{ id: string }>(
            `INSERT INTO tasks (agent_id, title, description, priority, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       RETURNING id`,
            [agentId, task.title, task.description, task.priority, task.tags, embedding]
        );
        result.taskIds.push(rows[0].id);

        await query(
            `INSERT INTO memory_edges (agent_id, source_type, source_id, target_type, target_id, relation)
       VALUES ($1, 'task', $2, 'session', $3, 'derived_from')
       ON CONFLICT DO NOTHING`,
            [agentId, rows[0].id, sessionId]
        );
    }

    // Store events
    for (const evt of extracted.events) {
        let embedding: string | null = null;
        if (embeddingProvider) {
            try {
                const vec = await embeddingProvider.embed(evt.title + (evt.description ? `: ${evt.description}` : ''));
                embedding = `[${vec.join(',')}]`;
            } catch { /* skip */ }
        }

        const { rows } = await query<{ id: string }>(
            `INSERT INTO events (agent_id, title, event_type, description, severity, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       RETURNING id`,
            [agentId, evt.title, evt.event_type, evt.description,
                evt.severity, evt.tags, embedding]
        );
        result.eventIds.push(rows[0].id);

        await query(
            `INSERT INTO memory_edges (agent_id, source_type, source_id, target_type, target_id, relation)
       VALUES ($1, 'event', $2, 'session', $3, 'derived_from')
       ON CONFLICT DO NOTHING`,
            [agentId, rows[0].id, sessionId]
        );
    }

    return result;
}
