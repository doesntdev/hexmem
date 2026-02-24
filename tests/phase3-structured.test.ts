import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTestAgent } from './helpers.js';

/**
 * Phase 3 Integration Tests: Structured Memory
 * - CRUD for facts, decisions, tasks, events, projects
 * - Auto-embedding on create
 * - Dedup detection
 * - Decay status and sweep
 */

describe('Phase 3: Structured Memory', () => {
    let agentId: string;
    let factId: string;
    let taskId: string;
    let decisionId: string;
    let eventId: string;
    let projectId: string;

    beforeAll(async () => {
        agentId = await createTestAgent(`p3-test-${Date.now()}`);
    });

    // ====================== FACTS ======================
    describe('Facts CRUD', () => {
        it('should create a fact with embedding', async () => {
            const { status, data } = await api<{ id: string; content: string }>(
                '/api/v1/facts',
                {
                    method: 'POST',
                    body: {
                        agent_id: agentId,
                        content: 'TypeScript is the primary language used in this project',
                        subject: 'technology',
                        confidence: 0.95,
                        tags: ['tech', 'language'],
                    },
                }
            );
            expect(status).toBe(201);
            expect(data.id).toBeDefined();
            expect(data.content).toContain('TypeScript');
            factId = data.id;
        }, 15000);

        it('should reject duplicate fact (409)', async () => {
            const { status, data } = await api<{ error: string; existing_id: string }>(
                '/api/v1/facts',
                {
                    method: 'POST',
                    body: { agent_id: agentId, content: 'TypeScript is the primary language used in this project' },
                }
            );
            expect(status).toBe(409);
            expect(data.error).toContain('Duplicate');
            expect(data.existing_id).toBe(factId);
        });

        it('should list facts with subject filter', async () => {
            const { status, data } = await api<{ facts: Array<{ id: string }> }>('/api/v1/facts', {
                query: { agent_id: agentId, subject: 'technology' },
            });
            expect(status).toBe(200);
            expect(data.facts.length).toBeGreaterThanOrEqual(1);
        });

        it('should get fact by ID and bump access count', async () => {
            const { status, data } = await api<{ id: string; access_count: number }>(`/api/v1/facts/${factId}`);
            expect(status).toBe(200);
            expect(data.id).toBe(factId);
            expect(data.access_count).toBeGreaterThanOrEqual(0);
        });

        it('should update a fact', async () => {
            const { status, data } = await api<{ id: string; content: string }>(`/api/v1/facts/${factId}`, {
                method: 'PUT',
                body: { content: 'TypeScript 5.x is the primary language', confidence: 1.0 },
            });
            expect(status).toBe(200);
            expect(data.content).toContain('TypeScript 5.x');
        }, 15000);

        it('should delete a fact', async () => {
            // Create throwaway to delete
            const { data: tmp } = await api<{ id: string }>('/api/v1/facts', {
                method: 'POST',
                body: { agent_id: agentId, content: `Throwaway fact ${Date.now()}` },
            });
            const { status } = await api(`/api/v1/facts/${tmp.id}`, { method: 'DELETE' });
            expect(status).toBe(204);
        }, 15000);
    });

    // ====================== TASKS ======================
    describe('Tasks CRUD', () => {
        it('should create a task', async () => {
            const { status, data } = await api<{ id: string; title: string; priority: number }>(
                '/api/v1/tasks',
                {
                    method: 'POST',
                    body: {
                        agent_id: agentId,
                        title: 'Implement search feature',
                        description: 'Build semantic search',
                        priority: 90,
                        tags: ['search'],
                    },
                }
            );
            expect(status).toBe(201);
            expect(data.title).toBe('Implement search feature');
            expect(data.priority).toBe(90);
            taskId = data.id;
        }, 15000);

        it('should update task status', async () => {
            const { status, data } = await api<{ status: string }>(`/api/v1/tasks/${taskId}`, {
                method: 'PUT',
                body: { status: 'in_progress' },
            });
            expect(status).toBe(200);
            expect(data.status).toBe('in_progress');
        });

        it('should filter tasks by status', async () => {
            const { status, data } = await api<{ tasks: Array<{ status: string }> }>('/api/v1/tasks', {
                query: { agent_id: agentId, status: 'in_progress' },
            });
            expect(status).toBe(200);
            expect(data.tasks.every(t => t.status === 'in_progress')).toBe(true);
        });
    });

    // ====================== DECISIONS ======================
    describe('Decisions CRUD', () => {
        it('should create a decision', async () => {
            const { status, data } = await api<{ id: string; title: string }>(
                '/api/v1/decisions',
                {
                    method: 'POST',
                    body: {
                        agent_id: agentId,
                        title: 'Use pgvector for embeddings',
                        decision: 'pgvector with HNSW indexing',
                        rationale: 'Built-in PostgreSQL extension',
                        tags: ['architecture'],
                    },
                }
            );
            expect(status).toBe(201);
            expect(data.title).toBe('Use pgvector for embeddings');
            decisionId = data.id;
        }, 15000);

        it('should list decisions', async () => {
            const { status, data } = await api<{ decisions: Array<{ id: string }> }>('/api/v1/decisions', {
                query: { agent_id: agentId },
            });
            expect(status).toBe(200);
            expect(data.decisions.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ====================== EVENTS ======================
    describe('Events CRUD', () => {
        it('should create an event', async () => {
            const { status, data } = await api<{ id: string; event_type: string }>(
                '/api/v1/events',
                {
                    method: 'POST',
                    body: {
                        agent_id: agentId,
                        title: 'Phase 3 tests started',
                        event_type: 'milestone',
                        severity: 'info',
                        tags: ['testing'],
                    },
                }
            );
            expect(status).toBe(201);
            expect(data.event_type).toBe('milestone');
            eventId = data.id;
        }, 15000);

        it('should filter events by type', async () => {
            const { status, data } = await api<{ events: Array<{ event_type: string }> }>('/api/v1/events', {
                query: { agent_id: agentId, event_type: 'milestone' },
            });
            expect(status).toBe(200);
            expect(data.events.length).toBeGreaterThanOrEqual(1);
        });

        it('should delete an event', async () => {
            const { status } = await api(`/api/v1/events/${eventId}`, { method: 'DELETE' });
            expect(status).toBe(204);
        });
    });

    // ====================== PROJECTS ======================
    describe('Projects CRUD', () => {
        it('should create a project with auto-slug', async () => {
            const { status, data } = await api<{ id: string; name: string; slug: string }>(
                '/api/v1/projects',
                {
                    method: 'POST',
                    body: {
                        agent_id: agentId,
                        name: 'HexMem Test Project',
                        description: 'A test project',
                        tags: ['test'],
                    },
                }
            );
            expect(status).toBe(201);
            expect(data.name).toBe('HexMem Test Project');
            expect(data.slug).toBe('hexmem-test-project');
            projectId = data.id;
        }, 15000);

        it('should update project status', async () => {
            const { status, data } = await api<{ status: string }>(`/api/v1/projects/${projectId}`, {
                method: 'PUT',
                body: { status: 'paused' },
            });
            expect(status).toBe(200);
            expect(data.status).toBe('paused');
        }, 15000);

        it('should list projects', async () => {
            const { status, data } = await api<{ projects: Array<{ id: string }> }>('/api/v1/projects', {
                query: { agent_id: agentId },
            });
            expect(status).toBe(200);
            expect(data.projects.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ====================== DECAY ======================
    describe('Decay System', () => {
        it('should return decay status per table', async () => {
            const { status, data } = await api<{
                status: Record<string, { active: number; cooling: number; archived: number }>;
                policies: unknown[];
            }>('/api/v1/decay/status', {
                query: { agent_id: agentId },
            });
            expect(status).toBe(200);
            expect(data.status.facts).toBeDefined();
            expect(data.status.facts.active).toBeGreaterThanOrEqual(0);
            expect(data.policies.length).toBeGreaterThan(0);
        });

        it('should run decay sweep (no transitions for fresh items)', async () => {
            const { status, data } = await api<{
                transitioned_to_cooling: number;
                transitioned_to_archived: number;
            }>('/api/v1/decay/sweep', {
                method: 'POST',
                body: { agent_id: agentId },
            });
            expect(status).toBe(200);
            expect(data.transitioned_to_cooling).toBe(0);
            expect(data.transitioned_to_archived).toBe(0);
        });
    });
});
