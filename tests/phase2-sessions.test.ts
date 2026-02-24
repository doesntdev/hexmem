import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTestAgent } from './helpers.js';

/**
 * Phase 2 Integration Tests: Session Memory
 * - Session lifecycle (start, ingest, list, get, end)
 * - Inline extraction
 * - Session summarization
 * - Semantic search
 */

describe('Phase 2: Session Memory', () => {
    let agentId: string;
    let sessionId: string;

    beforeAll(async () => {
        agentId = await createTestAgent(`p2-test-${Date.now()}`);
    });

    describe('Session Lifecycle', () => {
        it('should start a new session', async () => {
            const { status, data } = await api<{ id: string; agent_id: string }>('/api/v1/sessions', {
                method: 'POST',
                body: { agent_id: agentId, metadata: { purpose: 'testing' } },
            });
            expect(status).toBe(201);
            expect(data.id).toBeDefined();
            expect(data.agent_id).toBe(agentId);
            sessionId = data.id;
        });

        it('should ingest a message with inline extraction', async () => {
            const { status, data } = await api<{
                message: { id: string };
                extracted: { facts: number; decisions: number; tasks: number; events: number };
            }>(`/api/v1/sessions/${sessionId}/messages`, {
                method: 'POST',
                body: {
                    role: 'user',
                    content: 'We decided to use PostgreSQL for the database because it supports vector extensions. The main task is to implement the search feature by next Friday.',
                },
            });
            expect(status).toBe(201);
            expect(data.message.id).toBeDefined();
            expect(data.extracted).toBeDefined();
            const total = data.extracted.facts + data.extracted.decisions + data.extracted.tasks + data.extracted.events;
            expect(total).toBeGreaterThan(0);
        }, 30000);

        it('should ingest a second message', async () => {
            const { status, data } = await api<{ message: { id: string } }>(`/api/v1/sessions/${sessionId}/messages`, {
                method: 'POST',
                body: {
                    role: 'assistant',
                    content: 'Understood. I will prioritize the PostgreSQL search implementation. The vector extension pgvector is already installed.',
                },
            });
            expect(status).toBe(201);
            expect(data.message.id).toBeDefined();
        }, 30000);

        it('should list sessions for agent', async () => {
            const { status, data } = await api<{ sessions: Array<{ id: string }> }>('/api/v1/sessions', {
                query: { agent_id: agentId },
            });
            expect(status).toBe(200);
            expect(data.sessions.length).toBeGreaterThanOrEqual(1);
            expect(data.sessions.some(s => s.id === sessionId)).toBe(true);
        });

        it('should get session details with message count', async () => {
            const { status, data } = await api<{ id: string; message_count: number }>(`/api/v1/sessions/${sessionId}`);
            expect(status).toBe(200);
            expect(data.id).toBe(sessionId);
            expect(data.message_count).toBe(2);
        });

        it('should list messages in session', async () => {
            const { status, data } = await api<{ messages: Array<{ content: string; role: string }> }>(
                `/api/v1/sessions/${sessionId}/messages`
            );
            expect(status).toBe(200);
            expect(data.messages.length).toBe(2);
            expect(data.messages[0].role).toBe('user');
            expect(data.messages[1].role).toBe('assistant');
        });

        it('should end session with summary', async () => {
            const { status, data } = await api<{ id: string; summary: string; ended_at: string }>(
                `/api/v1/sessions/${sessionId}/end`,
                { method: 'POST' }
            );
            expect(status).toBe(200);
            expect(data.ended_at).toBeDefined();
            expect(data.summary).toBeDefined();
            expect(data.summary.length).toBeGreaterThan(10);
        }, 30000);
    });

    describe('Semantic Search', () => {
        it('should find memories by semantic similarity', async () => {
            const { status, data } = await api<{ results: Array<{ type: string; similarity: number }> }>('/api/v1/search', {
                method: 'POST',
                body: { query: 'database vector extensions', agent_id: agentId, limit: 5 },
            });
            expect(status).toBe(200);
            expect(data.results.length).toBeGreaterThan(0);
            for (const r of data.results) {
                expect(r.similarity).toBeGreaterThan(0);
                expect(r.type).toBeDefined();
            }
        }, 15000);
    });
});
