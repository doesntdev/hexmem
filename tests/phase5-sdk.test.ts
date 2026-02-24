import { describe, it, expect, beforeAll } from 'vitest';
import { HexMem, HexMemError, getOpenClawTools } from '../sdk/index.js';

/**
 * Phase 5 Integration Tests: SDK + OpenClaw Tools
 * Tests the SDK client against the live API server.
 */

describe('Phase 5: SDK + OpenClaw Integration', () => {
    let mem: HexMem;
    let agentId: string;

    beforeAll(async () => {
        mem = new HexMem({
            baseUrl: 'http://localhost:3400',
            apiKey: 'hexmem_dev_key',
        });

        // Create a test agent via SDK
        const agent = await mem.createAgent(
            `sdk-test-${Date.now()}`,
            'SDK Test Agent',
            { description: 'Automated SDK test' }
        );
        agentId = agent.id;
        // Set as default for subsequent calls
        mem = new HexMem({
            baseUrl: 'http://localhost:3400',
            apiKey: 'hexmem_dev_key',
            agentId,
        });
    });

    // ====================== Client Basics ======================
    describe('SDK Client', () => {
        it('should get agent', async () => {
            const agent = await mem.getAgent();
            expect(agent.id).toBe(agentId);
            expect(agent.display_name).toBe('SDK Test Agent');
        });

        it('should list agents', async () => {
            const { agents } = await mem.listAgents();
            expect(agents.length).toBeGreaterThanOrEqual(1);
        });

        it('should throw HexMemError on 404', async () => {
            try {
                await mem.getAgent('nonexistent-slug-xyz');
                expect.fail('Should have thrown');
            } catch (err) {
                expect(err).toBeInstanceOf(HexMemError);
                expect((err as HexMemError).status).toBe(404);
            }
        });
    });

    // ====================== Core Memory ======================
    describe('Core Memory Self-Editing', () => {
        it('should update core memory', async () => {
            const result = await mem.updateCoreMemory({
                working_state: { current_task: 'running SDK tests' },
                preferences: { verbosity: 'concise' },
            });
            expect(result.core_memory.working_state).toEqual({ current_task: 'running SDK tests' });
            expect(result.core_memory.preferences).toEqual({ verbosity: 'concise' });
        });

        it('should read core memory', async () => {
            const core = await mem.getCoreMemory();
            expect(core.working_state).toEqual({ current_task: 'running SDK tests' });
        });

        it('should merge (not replace) core memory', async () => {
            await mem.updateCoreMemory({ new_key: 'new_value' });
            const core = await mem.getCoreMemory();
            // Previous keys should still exist
            expect(core.working_state).toBeDefined();
            expect(core.new_key).toBe('new_value');
        });
    });

    // ====================== Sessions ======================
    describe('Session Management', () => {
        let sessionId: string;

        it('should start session', async () => {
            const session = await mem.startSession({ metadata: { from: 'sdk-test' } });
            expect(session.id).toBeDefined();
            expect(session.agent_id).toBe(agentId);
            sessionId = session.id;
        });

        it('should add messages with extraction', async () => {
            const result = await mem.addMessage(sessionId, {
                role: 'user',
                content: 'The SDK test is confirming that all methods work correctly. We need to fix the login timeout bug.',
            });
            expect(result.message.id).toBeDefined();
            expect(result.extracted).toBeDefined();
        }, 30000);

        it('should get session with message count', async () => {
            const session = await mem.getSession(sessionId);
            expect(session.message_count).toBe(1);
        });

        it('should list messages', async () => {
            const { messages } = await mem.getMessages(sessionId);
            expect(messages.length).toBe(1);
            expect(messages[0].role).toBe('user');
        });

        it('should end session', async () => {
            const session = await mem.endSession(sessionId);
            expect(session.ended_at).toBeDefined();
            expect(session.summary).toBeDefined();
        }, 30000);
    });

    // ====================== Structured Memory via SDK ======================
    describe('Structured Memory', () => {
        let factId: string;
        let taskId: string;

        it('should store a fact', async () => {
            const fact = await mem.storeFact({
                content: 'The SDK supports all 5 memory types',
                subject: 'sdk',
                tags: ['meta'],
            });
            expect(fact.id).toBeDefined();
            expect(fact.content).toContain('SDK');
            factId = fact.id;
        }, 15000);

        it('should store a task', async () => {
            const task = await mem.storeTask({
                title: 'Write SDK documentation',
                description: 'Create README with usage examples',
                priority: 70,
            });
            expect(task.id).toBeDefined();
            taskId = task.id;
        }, 15000);

        it('should store a decision', async () => {
            const dec = await mem.storeDecision({
                title: 'Use fetch instead of axios',
                decision: 'Native fetch API',
                rationale: 'Zero dependencies, built into Node 18+',
            });
            expect(dec.id).toBeDefined();
        }, 15000);

        it('should store an event', async () => {
            const evt = await mem.storeEvent({
                title: 'SDK v1 test suite passing',
                eventType: 'milestone',
                severity: 'info',
            });
            expect(evt.id).toBeDefined();
        }, 15000);

        it('should store a project', async () => {
            const proj = await mem.storeProject({
                name: 'SDK Testing',
                description: 'Automated test project',
            });
            expect(proj.id).toBeDefined();
            expect(proj.slug).toBe('sdk-testing');
        }, 15000);

        it('should use store() dispatcher', async () => {
            const result = await mem.store('fact', { content: `Dispatcher test ${Date.now()}` });
            expect(result.id).toBeDefined();
        }, 15000);

        it('should create edge between fact and task', async () => {
            const edge = await mem.createEdge({
                sourceType: 'fact', sourceId: factId,
                targetType: 'task', targetId: taskId,
                relation: 'relates_to',
            });
            expect(edge.id).toBeDefined();
            expect(edge.relation).toBe('relates_to');
        });

        it('should get graph for fact', async () => {
            const graph = await mem.getGraph('fact', factId);
            expect(graph.total).toBeGreaterThanOrEqual(1);
            expect(graph.outgoing.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ====================== Search & Recall ======================
    describe('Search & Recall', () => {
        it('should search memories', async () => {
            const { results } = await mem.search('SDK documentation');
            expect(results.length).toBeGreaterThan(0);
        }, 15000);

        it('should recall with hybrid scoring', async () => {
            const result = await mem.recall('SDK testing');
            expect(result.total).toBeGreaterThan(0);
            expect(result.weights).toBeDefined();
            expect(result.results[0].score).toBeGreaterThan(0);
        }, 15000);

        it('should recall with type filter', async () => {
            const result = await mem.recall('documentation', { types: ['task'] });
            for (const r of result.results) {
                expect(r.type).toBe('task');
            }
        }, 15000);
    });

    // ====================== Decay ======================
    describe('Decay', () => {
        it('should get decay status', async () => {
            const status = await mem.getDecayStatus();
            expect(status.status.facts).toBeDefined();
        });

        it('should run decay sweep', async () => {
            const result = await mem.runDecaySweep();
            expect(result.transitioned_to_cooling).toBeGreaterThanOrEqual(0);
        });
    });

    // ====================== OpenClaw Tools ======================
    describe('OpenClaw Tool Definitions', () => {
        it('should return 3 tool definitions', () => {
            const tools = getOpenClawTools(mem);
            expect(tools.length).toBe(3);
            expect(tools.map(t => t.name).sort()).toEqual([
                'memory_recall', 'memory_store', 'memory_update_core',
            ]);
        });

        it('memory_store should store a fact', async () => {
            const tools = getOpenClawTools(mem);
            const storeTool = tools.find(t => t.name === 'memory_store')!;
            const result = await storeTool.handler({
                type: 'fact',
                content: `OpenClaw tool test fact ${Date.now()}`,
                tags: 'testing,openclaw',
            }) as { id: string };
            expect(result.id).toBeDefined();
        }, 15000);

        it('memory_recall should return results', async () => {
            const tools = getOpenClawTools(mem);
            const recallTool = tools.find(t => t.name === 'memory_recall')!;
            const result = await recallTool.handler({
                query: 'SDK test',
                limit: 3,
            }) as { total: number; results: unknown[] };
            expect(result.total).toBeGreaterThan(0);
        }, 15000);

        it('memory_update_core should update core memory', async () => {
            const tools = getOpenClawTools(mem);
            const coreTool = tools.find(t => t.name === 'memory_update_core')!;
            const result = await coreTool.handler({
                updates: JSON.stringify({ tool_test: true }),
            }) as { core_memory: Record<string, unknown> };
            expect(result.core_memory.tool_test).toBe(true);
        });
    });
});
