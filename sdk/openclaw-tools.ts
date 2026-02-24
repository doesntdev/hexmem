/**
 * OpenClaw tool definitions for HexMem integration.
 *
 * These tool definitions allow OpenClaw agents to store memories and
 * recall context via the HexMem SDK.
 *
 * Usage:
 *   import { HexMem, getOpenClawTools } from '@hexmem/sdk';
 *   const mem = new HexMem({ baseUrl: '...', apiKey: '...', agentId: 'my-agent' });
 *   const tools = getOpenClawTools(mem);
 *   // Register `tools` with your OpenClaw agent
 */

import type { HexMem } from './client.js';

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
            items?: { type: string };
            default?: unknown;
        }>;
        required: string[];
    };
    handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/** memory_store — store a structured memory item */
export const memoryStoreToolDef = (mem: HexMem): ToolDefinition => ({
    name: 'memory_store',
    description: 'Store a fact, decision, task, event, or project in long-term memory. Facts are short knowledge statements. Decisions record choices with rationale. Tasks track work items. Events log what happened.',
    parameters: {
        type: 'object',
        properties: {
            type: {
                type: 'string',
                description: 'The type of memory to store',
                enum: ['fact', 'decision', 'task', 'event', 'project'],
            },
            content: {
                type: 'string',
                description: 'The main content (for facts: the fact text; for decisions/tasks/events/projects: the title)',
            },
            details: {
                type: 'string',
                description: 'Additional details (decision rationale, task description, event description, project description)',
            },
            tags: {
                type: 'string',
                description: 'Comma-separated tags for categorization',
            },
            priority: {
                type: 'number',
                description: 'Priority 1-100 (only for tasks)',
                default: 50,
            },
            event_type: {
                type: 'string',
                description: 'Event type (only for events)',
                enum: ['discovery', 'error', 'milestone', 'change', 'interaction', 'system'],
            },
            severity: {
                type: 'string',
                description: 'Severity (only for events)',
                enum: ['info', 'warning', 'critical'],
            },
        },
        required: ['type', 'content'],
    },
    handler: async (params) => {
        const type = params.type as string;
        const content = params.content as string;
        const details = params.details as string | undefined;
        const tags = params.tags ? (params.tags as string).split(',').map(t => t.trim()) : undefined;

        switch (type) {
            case 'fact':
                return mem.storeFact({ content, tags });
            case 'decision':
                return mem.storeDecision({ title: content, decision: content, rationale: details, tags });
            case 'task':
                return mem.storeTask({
                    title: content, description: details,
                    priority: params.priority as number | undefined, tags,
                });
            case 'event':
                return mem.storeEvent({
                    title: content, description: details,
                    eventType: (params.event_type as string) || 'discovery',
                    severity: (params.severity as string) || 'info', tags,
                });
            case 'project':
                return mem.storeProject({ name: content, description: details, tags });
            default:
                throw new Error(`Unknown memory type: ${type}`);
        }
    },
});

/** memory_recall — search long-term memory for relevant context */
export const memoryRecallToolDef = (mem: HexMem): ToolDefinition => ({
    name: 'memory_recall',
    description: 'Search long-term memory for relevant context. Uses hybrid retrieval combining semantic similarity, keyword matching, and recency. Returns ranked results with optional related items via graph traversal.',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Natural language query describing what to recall',
            },
            types: {
                type: 'string',
                description: 'Comma-separated memory types to search (fact,decision,task,event,session_message). Leave empty to search all.',
            },
            limit: {
                type: 'number',
                description: 'Max results to return',
                default: 10,
            },
            include_related: {
                type: 'string',
                description: 'Whether to include 1-hop related items (true/false)',
                default: 'true',
            },
        },
        required: ['query'],
    },
    handler: async (params) => {
        const types = params.types
            ? (params.types as string).split(',').map(t => t.trim())
            : undefined;

        const result = await mem.recall(params.query as string, {
            types,
            limit: (params.limit as number) || 10,
            includeRelated: params.include_related !== 'false',
        });

        // Format for agent consumption
        return {
            total: result.total,
            results: result.results.map(r => ({
                type: r.type,
                content: r.content,
                relevance: Math.round(r.score * 100) / 100,
                related: r.related?.map(rel => ({
                    type: rel.type,
                    content: rel.content,
                    relation: (rel.metadata as { relation?: string })?.relation,
                })),
            })),
        };
    },
});

/** memory_update_core — self-edit the agent's core memory */
const memoryCoreUpdateToolDef = (mem: HexMem): ToolDefinition => ({
    name: 'memory_update_core',
    description: 'Update the agent\'s core memory with new key-value pairs. Core memory persists across all sessions and represents the agent\'s long-term self-knowledge (e.g., working state, preferences, learned patterns). Set a key to null to remove it.',
    parameters: {
        type: 'object',
        properties: {
            updates: {
                type: 'string',
                description: 'JSON string of key-value pairs to merge into core memory. Example: {"current_task":"building auth","mood":"focused"}',
            },
        },
        required: ['updates'],
    },
    handler: async (params) => {
        const patch = JSON.parse(params.updates as string);
        return mem.updateCoreMemory(patch);
    },
});

/**
 * Returns all 3 OpenClaw tool definitions wired to a HexMem instance.
 */
export function getOpenClawTools(mem: HexMem): ToolDefinition[] {
    return [
        memoryStoreToolDef(mem),
        memoryRecallToolDef(mem),
        memoryCoreUpdateToolDef(mem),
    ];
}
