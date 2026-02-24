import { describe, it, expect, beforeAll } from 'vitest';
import { api, createTestAgent } from './helpers.js';

/**
 * Phase 1 Integration Tests: Foundation
 * - Auth middleware
 * - Agent CRUD
 * - API key management
 */

describe('Phase 1: Foundation', () => {
    let agentId: string;
    const agentSlug = `p1-test-${Date.now()}`;

    describe('Health & Auth', () => {
        it('should return 401 without auth header', async () => {
            const res = await fetch('http://localhost:3400/api/v1/agents');
            expect(res.status).toBe(401);
        });

        it('should return 401 with invalid key', async () => {
            const res = await fetch('http://localhost:3400/api/v1/agents', {
                headers: { Authorization: 'Bearer invalid_key_12345' },
            });
            expect(res.status).toBe(401);
        });
    });

    describe('Agent CRUD', () => {
        it('should create an agent', async () => {
            const { status, data } = await api<{ id: string; slug: string; display_name: string }>('/api/v1/agents', {
                method: 'POST',
                body: { slug: agentSlug, display_name: 'Phase 1 Test Agent', description: 'Test agent for Phase 1' },
            });
            expect(status).toBe(201);
            expect(data.id).toBeDefined();
            expect(data.slug).toBe(agentSlug);
            expect(data.display_name).toBe('Phase 1 Test Agent');
            agentId = data.id;
        });

        it('should get agent by slug', async () => {
            const { status, data } = await api<{ id: string; slug: string }>(`/api/v1/agents/${agentSlug}`);
            expect(status).toBe(200);
            expect(data.id).toBe(agentId);
        });

        it('should reject duplicate slugs', async () => {
            const { status } = await api('/api/v1/agents', {
                method: 'POST',
                body: { slug: agentSlug, display_name: 'Duplicate' },
            });
            expect(status).toBe(409);
        });

        it('should update agent via PATCH', async () => {
            const { status, data } = await api<{ display_name: string }>(`/api/v1/agents/${agentId}`, {
                method: 'PATCH',
                body: { display_name: 'Updated Agent Name' },
            });
            expect(status).toBe(200);
            expect(data.display_name).toBe('Updated Agent Name');
        });

        it('should update core memory via JSON merge patch', async () => {
            const { status, data } = await api<{ core_memory: Record<string, unknown> }>(`/api/v1/agents/${agentId}/core-memory`, {
                method: 'PATCH',
                body: { role: 'tester', version: 1 },
            });
            expect(status).toBe(200);
            expect(data.core_memory).toEqual({ role: 'tester', version: 1 });
        });

        it('should list agents', async () => {
            const { status, data } = await api<{ agents: unknown[] }>('/api/v1/agents');
            expect(status).toBe(200);
            expect(data.agents.length).toBeGreaterThanOrEqual(1);
        });

        it('should return 404 for non-existent agent', async () => {
            const { status } = await api('/api/v1/agents/nonexistent-slug-xyz');
            expect(status).toBe(404);
        });
    });

    describe('API Key Management', () => {
        let keyId: string;

        beforeAll(() => {
            expect(agentId).toBeDefined();
        });

        it('should create an API key', async () => {
            const { status, data } = await api<{ id: string; key: string; prefix: string }>('/api/v1/keys', {
                method: 'POST',
                body: { name: 'test-key', agent_id: agentId },
            });
            expect(status).toBe(201);
            expect(data.id).toBeDefined();
            expect(data.key).toMatch(/^hxm_/);
            expect(data.prefix).toBeDefined();
            keyId = data.id;
        });

        it('should list keys', async () => {
            const { status, data } = await api<{ keys: unknown[]; total: number }>('/api/v1/keys');
            expect(status).toBe(200);
            expect(data.keys.length).toBeGreaterThanOrEqual(1);
        });

        it('should revoke a key', async () => {
            const { status, data } = await api<{ message: string }>(`/api/v1/keys/${keyId}`, { method: 'DELETE' });
            expect(status).toBe(200);
            expect(data.message).toContain('revoked');
        });
    });
});
