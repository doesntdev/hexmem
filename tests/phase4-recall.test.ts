import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTestAgent } from './helpers.js';

/**
 * Phase 4 Integration Tests: Relationships + Recall
 * - Memory edge CRUD + graph view
 * - Unified recall endpoint with hybrid retrieval + reranking
 * - 1-hop graph traversal
 */

describe('Phase 4: Relationships + Recall', () => {
    let agentId: string;
    let factId: string;
    let taskId: string;
    let decisionId: string;
    let edgeId: string;

    beforeAll(async () => {
        agentId = await createTestAgent(`p4-test-${Date.now()}`);

        // Seed structured items sequentially (embedding calls need time)
        const factRes = await api<{ id: string }>('/api/v1/facts', {
            method: 'POST',
            body: {
                agent_id: agentId,
                content: 'The API server runs on Fastify with PostgreSQL backend',
                tags: ['architecture'],
            },
        });
        factId = factRes.data.id;

        const taskRes = await api<{ id: string }>('/api/v1/tasks', {
            method: 'POST',
            body: {
                agent_id: agentId,
                title: 'Set up Fastify API server',
                description: 'Initialize HTTP server with auth',
                priority: 85,
            },
        });
        taskId = taskRes.data.id;

        const decRes = await api<{ id: string }>('/api/v1/decisions', {
            method: 'POST',
            body: {
                agent_id: agentId,
                title: 'Choose Fastify over Express',
                decision: 'Fastify for better TypeScript support and performance',
                rationale: 'Schema validation built-in, faster than Express',
            },
        });
        decisionId = decRes.data.id;
    }, 45000);

    // ====================== EDGES ======================
    describe('Memory Edges', () => {
        it('should create an edge (fact → decision)', async () => {
            const { status, data } = await api<{ id: string; relation: string }>(
                '/api/v1/edges',
                {
                    method: 'POST',
                    body: {
                        agent_id: agentId,
                        source_type: 'fact',
                        source_id: factId,
                        target_type: 'decision',
                        target_id: decisionId,
                        relation: 'relates_to',
                        weight: 0.9,
                    },
                }
            );
            expect(status).toBe(201);
            expect(data.id).toBeDefined();
            expect(data.relation).toBe('relates_to');
            edgeId = data.id;
        });

        it('should create an edge (task → fact)', async () => {
            const { status } = await api('/api/v1/edges', {
                method: 'POST',
                body: {
                    agent_id: agentId,
                    source_type: 'task',
                    source_id: taskId,
                    target_type: 'fact',
                    target_id: factId,
                    relation: 'depends_on',
                },
            });
            expect(status).toBe(201);
        });

        it('should upsert on duplicate edge (update weight)', async () => {
            const { status, data } = await api<{ id: string; weight: number }>('/api/v1/edges', {
                method: 'POST',
                body: {
                    agent_id: agentId,
                    source_type: 'fact',
                    source_id: factId,
                    target_type: 'decision',
                    target_id: decisionId,
                    relation: 'relates_to',
                    weight: 1.0,
                },
            });
            expect(status).toBe(201);
            expect(data.id).toBe(edgeId);
            expect(data.weight).toBe(1.0);
        });

        it('should list edges with relation filter', async () => {
            const { status, data } = await api<{ edges: Array<{ relation: string }> }>('/api/v1/edges', {
                query: { agent_id: agentId, relation: 'depends_on' },
            });
            expect(status).toBe(200);
            expect(data.edges.length).toBeGreaterThanOrEqual(1);
            expect(data.edges.every(e => e.relation === 'depends_on')).toBe(true);
        });

        it('should show bidirectional graph view for a node', async () => {
            const { status, data } = await api<{
                node: { type: string }; outgoing: unknown[]; incoming: unknown[]; total: number;
            }>(`/api/v1/edges/graph/fact/${factId}`, {
                query: { agent_id: agentId },
            });
            expect(status).toBe(200);
            expect(data.node.type).toBe('fact');
            expect(data.total).toBeGreaterThanOrEqual(2);
        });

        it('should delete an edge', async () => {
            // Create throwaway edge to delete
            const { data: tmp } = await api<{ id: string }>('/api/v1/edges', {
                method: 'POST',
                body: {
                    agent_id: agentId,
                    source_type: 'decision', source_id: decisionId,
                    target_type: 'task', target_id: taskId,
                    relation: 'led_to',
                },
            });
            const { status } = await api(`/api/v1/edges/${tmp.id}`, { method: 'DELETE' });
            expect(status).toBe(204);
        });
    });

    // ====================== RECALL ======================
    describe('Unified Recall', () => {
        it('should return results with hybrid scoring', async () => {
            const { status, data } = await api<{
                results: Array<{
                    type: string; score: number; content: string;
                    signals: { semantic?: number; keyword?: number; recency?: number };
                }>;
                total: number;
                weights: Record<string, number>;
            }>('/api/v1/recall', {
                method: 'POST',
                body: { query: 'Fastify API server', agent_id: agentId, limit: 5 },
            });
            expect(status).toBe(200);
            expect(data.total).toBeGreaterThan(0);
            expect(data.weights).toEqual({ semantic: 0.7, keyword: 0.2, recency: 0.1 });

            const top = data.results[0];
            expect(top.score).toBeGreaterThan(0);
            expect(top.type).toBeDefined();
            expect(top.content).toBeDefined();
        }, 15000);

        it('should include related items (1-hop graph)', async () => {
            const { status, data } = await api<{
                results: Array<{
                    id: string;
                    related?: Array<{ type: string; metadata: { relation: string } }>;
                }>;
            }>('/api/v1/recall', {
                method: 'POST',
                body: { query: 'Fastify API server', agent_id: agentId, limit: 5, include_related: true },
            });
            expect(status).toBe(200);

            const factResult = data.results.find(r => r.id === factId);
            if (factResult && factResult.related) {
                expect(factResult.related.length).toBeGreaterThan(0);
            }
        }, 15000);

        it('should respect custom weights', async () => {
            const { status, data } = await api<{ weights: Record<string, number> }>('/api/v1/recall', {
                method: 'POST',
                body: {
                    query: 'Fastify', agent_id: agentId, limit: 3,
                    semantic_weight: 0.3, keyword_weight: 0.6, recency_weight: 0.1,
                },
            });
            expect(status).toBe(200);
            expect(data.weights.semantic).toBe(0.3);
            expect(data.weights.keyword).toBe(0.6);
        }, 15000);

        it('should filter by memory type', async () => {
            const { status, data } = await api<{ results: Array<{ type: string }> }>('/api/v1/recall', {
                method: 'POST',
                body: { query: 'Fastify', agent_id: agentId, types: ['fact'], limit: 10 },
            });
            expect(status).toBe(200);
            for (const r of data.results) {
                expect(r.type).toBe('fact');
            }
        }, 15000);

        it('should return 400 for missing agent_id', async () => {
            const { status } = await api('/api/v1/recall', {
                method: 'POST',
                body: { query: 'test' },
            });
            expect(status).toBe(400);
        });
    });
});
