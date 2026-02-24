import type { FastifyInstance } from 'fastify';
import { query } from '../db/connection.js';
import { getEmbeddingProvider } from '../server.js';
import { checkDuplicate } from '../services/dedup.js';

/**
 * CRUD routes for all structured memory types:
 * facts, decisions, tasks, events, projects
 */
export async function memoryRoutes(app: FastifyInstance): Promise<void> {

    // ====================== FACTS ======================

    app.post('/api/v1/facts', async (request, reply) => {
        const { agent_id, content, subject, confidence, source, tags } = request.body as {
            agent_id: string; content: string; subject?: string;
            confidence?: number; source?: string; tags?: string[];
        };
        if (!agent_id || !content) return reply.code(400).send({ error: 'agent_id and content are required' });

        // Dedup check
        const dup = await checkDuplicate('facts', agent_id, content);
        if (dup) return reply.code(409).send({ error: 'Duplicate fact detected', existing_id: dup.id, similarity: dup.similarity });

        const embedding = await embedText(content);
        const { rows } = await query(
            `INSERT INTO facts (agent_id, content, subject, confidence, source, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector) RETURNING *`,
            [agent_id, content, subject || null, confidence ?? 0.8, source || null, tags || [], embedding]
        );
        return reply.code(201).send(rows[0]);
    });

    app.get('/api/v1/facts', async (request, reply) => {
        const { agent_id, subject, limit, offset } = request.query as {
            agent_id?: string; subject?: string; limit?: string; offset?: string;
        };
        const lim = Math.min(parseInt(limit || '50', 10), 100);
        const off = parseInt(offset || '0', 10);

        let sql = 'SELECT * FROM facts WHERE decay_status = \'active\'';
        const params: unknown[] = [];
        let idx = 1;
        if (agent_id) { sql += ` AND agent_id = $${idx++}`; params.push(agent_id); }
        if (subject) { sql += ` AND subject ILIKE $${idx++}`; params.push(`%${subject}%`); }
        sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(lim, off);

        const { rows } = await query(sql, params);
        return reply.send({ facts: rows, total: rows.length });
    });

    app.get('/api/v1/facts/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('SELECT * FROM facts WHERE id = $1', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Fact not found' });
        // Bump access
        await query('UPDATE facts SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1', [id]);
        return reply.send(rows[0]);
    });

    app.put('/api/v1/facts/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { content, subject, confidence, source, tags } = request.body as Record<string, unknown>;
        const embedding = content ? await embedText(content as string) : null;
        const { rows } = await query(
            `UPDATE facts SET
        content = COALESCE($2, content), subject = COALESCE($3, subject),
        confidence = COALESCE($4, confidence), source = COALESCE($5, source),
        tags = COALESCE($6, tags), embedding = COALESCE($7::vector, embedding)
       WHERE id = $1 RETURNING *`,
            [id, content, subject, confidence, source, tags, embedding]
        );
        if (rows.length === 0) return reply.code(404).send({ error: 'Fact not found' });
        return reply.send(rows[0]);
    });

    app.delete('/api/v1/facts/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('DELETE FROM facts WHERE id = $1 RETURNING id', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Fact not found' });
        return reply.code(204).send();
    });

    // ====================== DECISIONS ======================

    app.post('/api/v1/decisions', async (request, reply) => {
        const { agent_id, title, decision, rationale, alternatives, session_id, tags } = request.body as {
            agent_id: string; title: string; decision: string; rationale?: string;
            alternatives?: unknown[]; session_id?: string; tags?: string[];
        };
        if (!agent_id || !title || !decision) return reply.code(400).send({ error: 'agent_id, title, and decision are required' });

        const dup = await checkDuplicate('decisions', agent_id, `${title}: ${decision}`);
        if (dup) return reply.code(409).send({ error: 'Duplicate decision detected', existing_id: dup.id, similarity: dup.similarity });

        const embeddingText = `${title}: ${decision}`;
        const embedding = await embedText(embeddingText);
        const { rows } = await query(
            `INSERT INTO decisions (agent_id, title, decision, rationale, alternatives, session_id, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector) RETURNING *`,
            [agent_id, title, decision, rationale || null, JSON.stringify(alternatives || []),
                session_id || null, tags || [], embedding]
        );
        return reply.code(201).send(rows[0]);
    });

    app.get('/api/v1/decisions', async (request, reply) => {
        const { agent_id, limit, offset } = request.query as { agent_id?: string; limit?: string; offset?: string };
        const lim = Math.min(parseInt(limit || '50', 10), 100);
        const off = parseInt(offset || '0', 10);
        let sql = 'SELECT * FROM decisions WHERE decay_status = \'active\'';
        const params: unknown[] = [];
        let idx = 1;
        if (agent_id) { sql += ` AND agent_id = $${idx++}`; params.push(agent_id); }
        sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(lim, off);
        const { rows } = await query(sql, params);
        return reply.send({ decisions: rows, total: rows.length });
    });

    app.get('/api/v1/decisions/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('SELECT * FROM decisions WHERE id = $1', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Decision not found' });
        await query('UPDATE decisions SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1', [id]);
        return reply.send(rows[0]);
    });

    app.delete('/api/v1/decisions/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('DELETE FROM decisions WHERE id = $1 RETURNING id', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Decision not found' });
        return reply.code(204).send();
    });

    // ====================== TASKS ======================

    app.post('/api/v1/tasks', async (request, reply) => {
        const { agent_id, title, description, status, priority, project_id, tags } = request.body as {
            agent_id: string; title: string; description?: string; status?: string;
            priority?: number; project_id?: string; tags?: string[];
        };
        if (!agent_id || !title) return reply.code(400).send({ error: 'agent_id and title are required' });

        const dup = await checkDuplicate('tasks', agent_id, title);
        if (dup) return reply.code(409).send({ error: 'Duplicate task detected', existing_id: dup.id, similarity: dup.similarity });

        const embeddingText = title + (description ? `: ${description}` : '');
        const embedding = await embedText(embeddingText);
        const { rows } = await query(
            `INSERT INTO tasks (agent_id, title, description, status, priority, project_id, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector) RETURNING *`,
            [agent_id, title, description || null, status || 'not_started',
                priority ?? 50, project_id || null, tags || [], embedding]
        );
        return reply.code(201).send(rows[0]);
    });

    app.get('/api/v1/tasks', async (request, reply) => {
        const { agent_id, status, project_id, limit, offset } = request.query as {
            agent_id?: string; status?: string; project_id?: string; limit?: string; offset?: string;
        };
        const lim = Math.min(parseInt(limit || '50', 10), 100);
        const off = parseInt(offset || '0', 10);
        let sql = 'SELECT * FROM tasks WHERE decay_status = \'active\'';
        const params: unknown[] = [];
        let idx = 1;
        if (agent_id) { sql += ` AND agent_id = $${idx++}`; params.push(agent_id); }
        if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
        if (project_id) { sql += ` AND project_id = $${idx++}`; params.push(project_id); }
        sql += ` ORDER BY priority DESC, created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(lim, off);
        const { rows } = await query(sql, params);
        return reply.send({ tasks: rows, total: rows.length });
    });

    app.get('/api/v1/tasks/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('SELECT * FROM tasks WHERE id = $1', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Task not found' });
        await query('UPDATE tasks SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1', [id]);
        return reply.send(rows[0]);
    });

    app.put('/api/v1/tasks/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { title, description, status, priority, tags } = request.body as Record<string, unknown>;
        const embeddingText = title ? (title as string) + (description ? `: ${description}` : '') : null;
        const embedding = embeddingText ? await embedText(embeddingText) : null;
        const { rows } = await query(
            `UPDATE tasks SET
        title = COALESCE($2, title), description = COALESCE($3, description),
        status = COALESCE($4, status), priority = COALESCE($5, priority),
        tags = COALESCE($6, tags), embedding = COALESCE($7::vector, embedding)
       WHERE id = $1 RETURNING *`,
            [id, title, description, status, priority, tags, embedding]
        );
        if (rows.length === 0) return reply.code(404).send({ error: 'Task not found' });
        return reply.send(rows[0]);
    });

    app.delete('/api/v1/tasks/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('DELETE FROM tasks WHERE id = $1 RETURNING id', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Task not found' });
        return reply.code(204).send();
    });

    // ====================== EVENTS ======================

    app.post('/api/v1/events', async (request, reply) => {
        const { agent_id, title, event_type, description, severity, occurred_at, tags } = request.body as {
            agent_id: string; title: string; event_type: string; description?: string;
            severity?: string; occurred_at?: string; tags?: string[];
        };
        if (!agent_id || !title || !event_type) return reply.code(400).send({ error: 'agent_id, title, and event_type are required' });

        const embeddingText = title + (description ? `: ${description}` : '');
        const embedding = await embedText(embeddingText);
        const { rows } = await query(
            `INSERT INTO events (agent_id, title, event_type, description, severity, occurred_at, tags, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector) RETURNING *`,
            [agent_id, title, event_type, description || null,
                severity || 'info', occurred_at || new Date().toISOString(), tags || [], embedding]
        );
        return reply.code(201).send(rows[0]);
    });

    app.get('/api/v1/events', async (request, reply) => {
        const { agent_id, event_type, severity, limit, offset } = request.query as {
            agent_id?: string; event_type?: string; severity?: string; limit?: string; offset?: string;
        };
        const lim = Math.min(parseInt(limit || '50', 10), 100);
        const off = parseInt(offset || '0', 10);
        let sql = 'SELECT * FROM events WHERE decay_status = \'active\'';
        const params: unknown[] = [];
        let idx = 1;
        if (agent_id) { sql += ` AND agent_id = $${idx++}`; params.push(agent_id); }
        if (event_type) { sql += ` AND event_type = $${idx++}`; params.push(event_type); }
        if (severity) { sql += ` AND severity = $${idx++}`; params.push(severity); }
        sql += ` ORDER BY occurred_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(lim, off);
        const { rows } = await query(sql, params);
        return reply.send({ events: rows, total: rows.length });
    });

    app.get('/api/v1/events/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('SELECT * FROM events WHERE id = $1', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Event not found' });
        await query('UPDATE events SET access_count = access_count + 1, last_accessed_at = NOW() WHERE id = $1', [id]);
        return reply.send(rows[0]);
    });

    app.delete('/api/v1/events/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('DELETE FROM events WHERE id = $1 RETURNING id', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Event not found' });
        return reply.code(204).send();
    });

    // ====================== PROJECTS ======================

    app.post('/api/v1/projects', async (request, reply) => {
        const { agent_id, name, description, status, tags, metadata } = request.body as {
            agent_id: string; name: string; description?: string;
            status?: string; tags?: string[]; metadata?: Record<string, unknown>;
        };
        if (!agent_id || !name) return reply.code(400).send({ error: 'agent_id and name are required' });

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const embeddingText = name + (description ? `: ${description}` : '');
        const embedding = await embedText(embeddingText);
        const { rows } = await query(
            `INSERT INTO projects (agent_id, slug, name, description, status, tags, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector) RETURNING *`,
            [agent_id, slug, name, description || null, status || 'active',
                tags || [], metadata || {}, embedding]
        );
        return reply.code(201).send(rows[0]);
    });

    app.get('/api/v1/projects', async (request, reply) => {
        const { agent_id, status, limit, offset } = request.query as {
            agent_id?: string; status?: string; limit?: string; offset?: string;
        };
        const lim = Math.min(parseInt(limit || '50', 10), 100);
        const off = parseInt(offset || '0', 10);
        let sql = 'SELECT * FROM projects WHERE 1=1';
        const params: unknown[] = [];
        let idx = 1;
        if (agent_id) { sql += ` AND agent_id = $${idx++}`; params.push(agent_id); }
        if (status) { sql += ` AND status = $${idx++}`; params.push(status); }
        sql += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(lim, off);
        const { rows } = await query(sql, params);
        return reply.send({ projects: rows, total: rows.length });
    });

    app.get('/api/v1/projects/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('SELECT * FROM projects WHERE id = $1', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Project not found' });
        // Get associated tasks
        const { rows: tasks } = await query(
            'SELECT id, title, status, priority FROM tasks WHERE project_id = $1 ORDER BY priority DESC',
            [id]
        );
        return reply.send({ ...rows[0], tasks });
    });

    app.put('/api/v1/projects/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { name, description, status, tags, metadata } = request.body as Record<string, unknown>;
        const embeddingText = name ? (name as string) + (description ? `: ${description}` : '') : null;
        const embedding = embeddingText ? await embedText(embeddingText) : null;
        const { rows } = await query(
            `UPDATE projects SET
        name = COALESCE($2, name), description = COALESCE($3, description),
        status = COALESCE($4, status), tags = COALESCE($5, tags),
        metadata = COALESCE($6, metadata), embedding = COALESCE($7::vector, embedding)
       WHERE id = $1 RETURNING *`,
            [id, name, description, status, tags, metadata, embedding]
        );
        if (rows.length === 0) return reply.code(404).send({ error: 'Project not found' });
        return reply.send(rows[0]);
    });

    app.delete('/api/v1/projects/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { rows } = await query('DELETE FROM projects WHERE id = $1 RETURNING id', [id]);
        if (rows.length === 0) return reply.code(404).send({ error: 'Project not found' });
        return reply.code(204).send();
    });

    // ====================== DECAY STATUS ======================

    // GET /api/v1/decay/status — dashboard-facing decay overview
    app.get('/api/v1/decay/status', async (request, reply) => {
        const { agent_id } = request.query as { agent_id: string };
        if (!agent_id) return reply.code(400).send({ error: 'agent_id is required' });

        const tables = ['facts', 'decisions', 'tasks', 'events', 'session_messages'] as const;
        const status: Record<string, { active: number; cooling: number; archived: number }> = {};

        for (const table of tables) {
            const { rows } = await query<{ decay_status: string; count: string }>(
                `SELECT decay_status, COUNT(*) as count FROM ${table}
         WHERE agent_id = $1 GROUP BY decay_status`,
                [agent_id]
            );
            status[table] = { active: 0, cooling: 0, archived: 0 };
            for (const r of rows) {
                status[table][r.decay_status as 'active' | 'cooling' | 'archived'] = parseInt(r.count, 10);
            }
        }

        // Get decay policies
        const { rows: policies } = await query(
            'SELECT * FROM decay_policies WHERE agent_id = $1 OR agent_id IS NULL ORDER BY agent_id NULLS LAST',
            [agent_id]
        );

        return reply.send({ status, policies });
    });
}

// ---- Helper: embed text if provider available ----
async function embedText(text: string): Promise<string | null> {
    const provider = getEmbeddingProvider();
    if (!provider) return null;
    try {
        const vec = await provider.embed(text);
        return `[${vec.join(',')}]`;
    } catch {
        return null;
    }
}
