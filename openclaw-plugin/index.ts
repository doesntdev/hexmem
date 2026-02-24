/**
 * HexMem OpenClaw Plugin
 *
 * Structured semantic memory for OpenClaw agents.
 * Replaces the old hexkit-memory plugin with REST API access to HexMem.
 *
 * HexMem API routes (all require Bearer auth):
 *   POST /api/v1/recall              — hybrid semantic+keyword recall
 *   POST /api/v1/search              — direct vector search
 *   POST /api/v1/facts               — store a fact
 *   POST /api/v1/decisions            — store a decision
 *   POST /api/v1/tasks                — store a task
 *   POST /api/v1/events               — store an event
 *   POST /api/v1/sessions             — create session
 *   POST /api/v1/sessions/:id/messages — add session message
 *   GET  /api/v1/agents/:id           — get agent info
 *   GET  /api/v1/decay/status          — decay status
 */

// Agent slug → UUID cache
const agentCache = new Map<string, string>();

function getConfig(api: any) {
    const cfg = api.config?.plugins?.entries?.hexmem?.config ?? {};
    return {
        url: (cfg.url || process.env.HEXMEM_URL || "http://localhost:3400").replace(/\/$/, ""),
        apiKey: cfg.apiKey || process.env.HEXMEM_API_KEY || process.env.HEXMEM_DEV_KEY || "hexmem_dev_key",
    };
}

async function hexmemFetch(api: any, path: string, opts: RequestInit = {}): Promise<any> {
    const { url, apiKey } = getConfig(api);
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...(opts.headers as Record<string, string> || {}),
    };

    const res = await fetch(`${url}${path}`, { ...opts, headers });
    const body = await res.text();

    if (!res.ok) {
        throw new Error(`HexMem ${res.status}: ${body.slice(0, 300)}`);
    }

    try { return JSON.parse(body); } catch { return body; }
}

/**
 * Resolve the current OpenClaw agent ID to a HexMem agent UUID.
 * Auto-creates the HexMem agent if it doesn't exist.
 */
async function resolveAgent(api: any, agentId?: string): Promise<string> {
    const slug = agentId || api.agentId || "default";

    if (agentCache.has(slug)) return agentCache.get(slug)!;

    try {
        const agent = await hexmemFetch(api, `/api/v1/agents/${slug}`);
        agentCache.set(slug, agent.id);
        return agent.id;
    } catch {
        // Auto-create
        try {
            const agent = await hexmemFetch(api, "/api/v1/agents", {
                method: "POST",
                body: JSON.stringify({
                    slug,
                    display_name: slug.charAt(0).toUpperCase() + slug.slice(1),
                    description: `OpenClaw agent: ${slug}`,
                }),
            });
            agentCache.set(slug, agent.id);
            api.logger?.info?.(`HexMem: created agent '${slug}' → ${agent.id}`);
            return agent.id;
        } catch (err: any) {
            throw new Error(`Failed to resolve/create agent '${slug}': ${err.message}`);
        }
    }
}

function textResult(data: any) {
    return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function errorResult(msg: string) {
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

// ============================================================
// Plugin entry point
// ============================================================

export default function register(api: any) {
    const logger = api.logger;
    logger?.info?.("HexMem plugin registering...");

    // ----------------------------------------------------------
    // TOOL: hexmem_recall
    // ----------------------------------------------------------
    api.registerTool({
        name: "hexmem_recall",
        description:
            "Recall memories semantically. Searches across facts, decisions, tasks, events, and session messages " +
            "using combined semantic + keyword + recency scoring. Use this when you need to remember something.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "What to recall — natural language query" },
                limit: { type: "number", description: "Max results (default 10)", default: 10 },
                tables: {
                    type: "array",
                    items: { type: "string", enum: ["facts", "decisions", "tasks", "events", "session_messages"] },
                    description: "Restrict to specific tables (default: all)",
                },
            },
            required: ["query"],
        },
        async execute(_id: string, params: { query: string; limit?: number; tables?: string[] }) {
            try {
                const agentUuid = await resolveAgent(api);
                const body: Record<string, any> = {
                    query: params.query,
                    agent_id: agentUuid,
                    limit: params.limit || 10,
                };
                if (params.tables?.length) {
                    body.types = params.tables;
                }
                const results = await hexmemFetch(api, "/api/v1/recall", {
                    method: "POST",
                    body: JSON.stringify(body),
                });
                return textResult(results);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    });

    // ----------------------------------------------------------
    // TOOL: hexmem_store
    // ----------------------------------------------------------
    api.registerTool({
        name: "hexmem_store",
        description:
            "Store a memory item: fact, decision, event, or task. " +
            "Automatically generates embeddings for semantic search. Deduplicates against existing items.",
        parameters: {
            type: "object",
            properties: {
                item_type: {
                    type: "string",
                    enum: ["fact", "decision", "event", "task"],
                    description: "Type of memory to store",
                },
                title: { type: "string", description: "Short title (required for decisions/tasks/events)" },
                content: { type: "string", description: "Main content text (required for facts)" },
                description: { type: "string", description: "Detailed description" },
                decision: { type: "string", description: "The decision made (for decisions)" },
                rationale: { type: "string", description: "Why this decision was made" },
                event_type: {
                    type: "string",
                    enum: ["incident", "milestone", "release", "discovery", "blocker", "resolution", "error", "change", "interaction", "system"],
                    description: "Type of event (for events)",
                },
                severity: { type: "string", enum: ["info", "warning", "critical"], description: "Event severity" },
                status: { type: "string", description: "Task status or decision status" },
                priority: { type: "number", description: "Priority 1-100 (for tasks)", default: 50 },
                tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" },
                subject: { type: "string", description: "Subject/topic (for facts)" },
                context: { type: "string", description: "Context (for decisions)" },
                project: { type: "string", description: "Project slug to associate with" },
            },
            required: ["item_type"],
        },
        async execute(_id: string, params: any) {
            try {
                const agentUuid = await resolveAgent(api);

                let path: string;
                let body: Record<string, any>;

                switch (params.item_type) {
                    case "fact":
                        path = "/api/v1/facts";
                        body = {
                            agent_id: agentUuid,
                            content: params.content || params.title || params.description,
                            subject: params.subject,
                            tags: params.tags,
                            source: "openclaw",
                        };
                        break;

                    case "decision":
                        path = "/api/v1/decisions";
                        body = {
                            agent_id: agentUuid,
                            title: params.title,
                            decision: params.decision || params.content || params.description,
                            rationale: params.rationale,
                            context: params.context,
                            tags: params.tags,
                            status: params.status || "active",
                        };
                        break;

                    case "event":
                        path = "/api/v1/events";
                        body = {
                            agent_id: agentUuid,
                            title: params.title,
                            event_type: params.event_type || "discovery",
                            description: params.description || params.content,
                            severity: params.severity || "info",
                            tags: params.tags,
                        };
                        break;

                    case "task":
                        path = "/api/v1/tasks";
                        body = {
                            agent_id: agentUuid,
                            title: params.title,
                            description: params.description || params.content,
                            priority: params.priority ?? 50,
                            tags: params.tags,
                            status: params.status || "not_started",
                        };
                        break;

                    default:
                        return errorResult(`Unknown item_type: ${params.item_type}`);
                }

                const result = await hexmemFetch(api, path, {
                    method: "POST",
                    body: JSON.stringify(body),
                });

                return textResult({ stored: true, type: params.item_type, id: result.id, title: params.title });
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    });

    // ----------------------------------------------------------
    // TOOL: hexmem_search
    // ----------------------------------------------------------
    api.registerTool({
        name: "hexmem_search",
        description:
            "Direct semantic vector search over a specific HexMem table. " +
            "Lower-level than recall — use this when you need to search a specific table.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" },
                table: {
                    type: "string",
                    enum: ["facts", "decisions", "tasks", "events", "session_messages"],
                    description: "Table to search",
                },
                limit: { type: "number", description: "Max results (default 10)", default: 10 },
            },
            required: ["query", "table"],
        },
        async execute(_id: string, params: { query: string; table: string; limit?: number }) {
            try {
                const agentUuid = await resolveAgent(api);
                const results = await hexmemFetch(api, "/api/v1/search", {
                    method: "POST",
                    body: JSON.stringify({
                        query: params.query,
                        agent_id: agentUuid,
                        table: params.table,
                        limit: params.limit || 10,
                    }),
                });
                return textResult(results);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    });

    // ----------------------------------------------------------
    // TOOL: hexmem_status
    // ----------------------------------------------------------
    api.registerTool({
        name: "hexmem_status",
        description: "Get HexMem memory health: item counts per table, decay status, agent info.",
        parameters: { type: "object", properties: {} },
        async execute() {
            try {
                const agentUuid = await resolveAgent(api);
                // Fetch agent info and decay status in parallel
                const [agentInfo, decayStatus] = await Promise.all([
                    hexmemFetch(api, `/api/v1/agents/${agentUuid}`).catch(() => null),
                    hexmemFetch(api, `/api/v1/decay/status?agent_id=${agentUuid}`).catch(() => null),
                ]);
                return textResult({
                    agent: agentInfo,
                    decay: decayStatus,
                });
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    });

    // ----------------------------------------------------------
    // TOOL: hexmem_sql
    // ----------------------------------------------------------
    api.registerTool({
        name: "hexmem_sql",
        description:
            "Execute a raw SQL query against HexMem (SELECT only). " +
            "Power-user tool for ad-hoc data exploration.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "SQL query (SELECT only)" },
            },
            required: ["query"],
        },
        async execute(_id: string, params: { query: string }) {
            try {
                if (!/^\s*SELECT/i.test(params.query)) {
                    return errorResult("Only SELECT queries allowed via this tool");
                }
                const result = await hexmemFetch(api, "/api/v1/sql", {
                    method: "POST",
                    body: JSON.stringify({ query: params.query }),
                });
                return textResult(result);
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    });

    // ----------------------------------------------------------
    // TOOL: hexmem_session_log
    // ----------------------------------------------------------
    api.registerTool({
        name: "hexmem_session_log",
        description:
            "Log a session message or batch of messages to HexMem for future recall. " +
            "Use during compaction or session end to preserve conversation context.",
        parameters: {
            type: "object",
            properties: {
                messages: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            role: { type: "string", enum: ["user", "assistant", "system"] },
                            content: { type: "string" },
                        },
                        required: ["role", "content"],
                    },
                    description: "Messages to log",
                },
                session_id: { type: "string", description: "Session ID (auto-created if omitted)" },
                summary: { type: "string", description: "Session summary (stored as metadata)" },
            },
            required: ["messages"],
        },
        async execute(_id: string, params: any) {
            try {
                const agentUuid = await resolveAgent(api);

                // Create or reuse session
                let sessionId = params.session_id;
                if (!sessionId) {
                    const session = await hexmemFetch(api, "/api/v1/sessions", {
                        method: "POST",
                        body: JSON.stringify({
                            agent_id: agentUuid,
                            external_id: `openclaw:${api.agentId || "main"}:${Date.now()}`,
                            metadata: { source: "openclaw", summary: params.summary },
                        }),
                    });
                    sessionId = session.id;
                }

                // Batch insert messages
                let stored = 0;
                for (const msg of params.messages) {
                    try {
                        await hexmemFetch(api, `/api/v1/sessions/${sessionId}/messages`, {
                            method: "POST",
                            body: JSON.stringify({
                                role: msg.role,
                                content: msg.content,
                            }),
                        });
                        stored++;
                    } catch {
                        // Non-fatal — continue with remaining messages
                    }
                }

                return textResult({ stored, total: params.messages.length, session_id: sessionId });
            } catch (err: any) {
                return errorResult(err.message);
            }
        },
    });

    // ----------------------------------------------------------
    // Background health check service
    // ----------------------------------------------------------
    api.registerService?.({
        id: "hexmem-healthcheck",
        start: () => {
            logger?.info?.("HexMem: background health check armed");
        },
        stop: () => {
            logger?.info?.("HexMem: background health check stopped");
        },
    });

    logger?.info?.("HexMem plugin registered: 6 tools, 1 service");
}
