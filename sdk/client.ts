/**
 * HexMem SDK Client
 *
 * Lightweight TypeScript client wrapping the HexMem REST API.
 * All methods return typed responses and throw HexMemError on failure.
 */

import type {
    HexMemConfig, Agent, Session, Message, Fact, Decision,
    Task, Event, Project, Edge, RecallResult, RecallOptions,
    SearchResult, DecayStatus, ListOptions,
} from './types.js';

export class HexMemError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: Record<string, unknown>,
    ) {
        super(`HexMem API error ${status}: ${body.error || JSON.stringify(body)}`);
        this.name = 'HexMemError';
    }
}

export class HexMem {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private agentId: string | undefined;

    constructor(config: HexMemConfig) {
        this.baseUrl = config.baseUrl.replace(/\/$/, '');
        this.apiKey = config.apiKey;
        this.agentId = config.agentId;
    }

    // ============================
    //  HTTP Helpers
    // ============================

    private async request<T>(
        method: string, path: string,
        options: { body?: Record<string, unknown>; query?: Record<string, string> } = {}
    ): Promise<T> {
        let url = `${this.baseUrl}${path}`;
        if (options.query) {
            const params = new URLSearchParams(options.query);
            url += `?${params.toString()}`;
        }

        const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` };
        if (options.body) headers['Content-Type'] = 'application/json';

        const res = await fetch(url, {
            method,
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
        });

        if (res.status === 204) return {} as T;
        const data = await res.json() as Record<string, unknown>;
        if (res.status >= 400) throw new HexMemError(res.status, data);
        return data as T;
    }

    private requireAgentId(agentId?: string): string {
        const id = agentId || this.agentId;
        if (!id) throw new Error('agentId is required — set it in config or pass per-call');
        return id;
    }

    // UUID cache for slug resolution
    private readonly slugCache = new Map<string, string>();

    /** Resolve an agent slug or ID to a UUID. Caches results. */
    async resolveAgentId(idOrSlug?: string): Promise<string> {
        const raw = this.requireAgentId(idOrSlug);
        // Already a UUID
        if (/^[0-9a-f]{8}-/i.test(raw)) return raw;
        // Check cache
        if (this.slugCache.has(raw)) return this.slugCache.get(raw)!;
        // Resolve via API
        const agent = await this.getAgent(raw);
        this.slugCache.set(raw, agent.id);
        return agent.id;
    }

    // ============================
    //  Agent Management
    // ============================

    async getAgent(idOrSlug?: string): Promise<Agent> {
        const id = idOrSlug || this.requireAgentId();
        return this.request<Agent>('GET', `/api/v1/agents/${id}`);
    }

    async listAgents(): Promise<{ agents: Agent[]; total: number }> {
        return this.request('GET', '/api/v1/agents');
    }

    async createAgent(slug: string, displayName: string, opts?: { description?: string; coreMemory?: Record<string, unknown> }): Promise<Agent> {
        return this.request('POST', '/api/v1/agents', {
            body: { slug, display_name: displayName, description: opts?.description, core_memory: opts?.coreMemory },
        });
    }

    async updateAgent(idOrSlug: string, updates: { displayName?: string; description?: string; config?: Record<string, unknown> }): Promise<Agent> {
        const body: Record<string, unknown> = {};
        if (updates.displayName !== undefined) body.display_name = updates.displayName;
        if (updates.description !== undefined) body.description = updates.description;
        if (updates.config !== undefined) body.config = updates.config;
        return this.request('PATCH', `/api/v1/agents/${idOrSlug}`, { body });
    }

    // ============================
    //  Core Memory Self-Editing
    // ============================

    async getCoreMemory(idOrSlug?: string): Promise<Record<string, unknown>> {
        const agent = await this.getAgent(idOrSlug);
        return agent.core_memory;
    }

    async updateCoreMemory(patch: Record<string, unknown>, idOrSlug?: string): Promise<{ core_memory: Record<string, unknown> }> {
        const id = idOrSlug || this.requireAgentId();
        return this.request('PATCH', `/api/v1/agents/${id}/core-memory`, { body: patch });
    }

    // ============================
    //  Sessions
    // ============================

    async startSession(opts?: { agentId?: string; externalId?: string; metadata?: Record<string, unknown> }): Promise<Session> {
        return this.request('POST', '/api/v1/sessions', {
            body: {
                agent_id: this.requireAgentId(opts?.agentId),
                external_id: opts?.externalId,
                metadata: opts?.metadata,
            },
        });
    }

    async getSession(sessionId: string): Promise<Session & { message_count: number }> {
        return this.request('GET', `/api/v1/sessions/${sessionId}`);
    }

    async listSessions(opts?: { agentId?: string } & ListOptions): Promise<{ sessions: Session[]; total: number }> {
        const query: Record<string, string> = {};
        const aid = opts?.agentId || this.agentId;
        if (aid) query.agent_id = aid;
        if (opts?.limit) query.limit = String(opts.limit);
        if (opts?.offset) query.offset = String(opts.offset);
        return this.request('GET', '/api/v1/sessions', { query });
    }

    async addMessage(sessionId: string, msg: { role: Message['role']; content: string; metadata?: Record<string, unknown> }): Promise<{
        message: Message;
        extracted: { facts: number; decisions: number; tasks: number; events: number };
    }> {
        return this.request('POST', `/api/v1/sessions/${sessionId}/messages`, { body: msg });
    }

    async getMessages(sessionId: string, opts?: ListOptions): Promise<{ messages: Message[]; total: number }> {
        const query: Record<string, string> = {};
        if (opts?.limit) query.limit = String(opts.limit);
        if (opts?.offset) query.offset = String(opts.offset);
        return this.request('GET', `/api/v1/sessions/${sessionId}/messages`, { query });
    }

    async endSession(sessionId: string): Promise<Session> {
        return this.request('POST', `/api/v1/sessions/${sessionId}/end`);
    }

    // ============================
    //  Structured Memory
    // ============================

    // --- Facts ---
    async storeFact(data: { content: string; subject?: string; confidence?: number; tags?: string[]; agentId?: string }): Promise<Fact> {
        return this.request('POST', '/api/v1/facts', {
            body: { agent_id: this.requireAgentId(data.agentId), content: data.content, subject: data.subject, confidence: data.confidence, tags: data.tags },
        });
    }
    async getFact(id: string): Promise<Fact> { return this.request('GET', `/api/v1/facts/${id}`); }
    async listFacts(opts?: { agentId?: string; subject?: string } & ListOptions): Promise<{ facts: Fact[] }> {
        const q: Record<string, string> = { agent_id: this.requireAgentId(opts?.agentId) };
        if (opts?.subject) q.subject = opts.subject;
        if (opts?.limit) q.limit = String(opts.limit);
        return this.request('GET', '/api/v1/facts', { query: q });
    }
    async updateFact(id: string, updates: Record<string, unknown>): Promise<Fact> { return this.request('PUT', `/api/v1/facts/${id}`, { body: updates }); }
    async deleteFact(id: string): Promise<void> { await this.request('DELETE', `/api/v1/facts/${id}`); }

    // --- Decisions ---
    async storeDecision(data: { title: string; decision: string; rationale?: string; alternatives?: unknown[]; tags?: string[]; agentId?: string; project?: string }): Promise<Decision> {
        return this.request('POST', '/api/v1/decisions', {
            body: { agent_id: this.requireAgentId(data.agentId), title: data.title, decision: data.decision, rationale: data.rationale, alternatives: data.alternatives, tags: data.tags },
        });
    }
    async getDecision(id: string): Promise<Decision> { return this.request('GET', `/api/v1/decisions/${id}`); }
    async listDecisions(opts?: { agentId?: string } & ListOptions): Promise<{ decisions: Decision[] }> {
        return this.request('GET', '/api/v1/decisions', { query: { agent_id: this.requireAgentId(opts?.agentId) } });
    }
    async updateDecision(id: string, updates: Record<string, unknown>): Promise<Decision> { return this.request('PUT', `/api/v1/decisions/${id}`, { body: updates }); }
    async deleteDecision(id: string): Promise<void> { await this.request('DELETE', `/api/v1/decisions/${id}`); }

    // --- Tasks ---
    async storeTask(data: { title: string; description?: string; priority?: number; status?: string; tags?: string[]; agentId?: string; projectId?: string }): Promise<Task> {
        return this.request('POST', '/api/v1/tasks', {
            body: { agent_id: this.requireAgentId(data.agentId), title: data.title, description: data.description, priority: data.priority, status: data.status, tags: data.tags, project_id: data.projectId },
        });
    }
    async getTask(id: string): Promise<Task> { return this.request('GET', `/api/v1/tasks/${id}`); }
    async listTasks(opts?: { agentId?: string; status?: string } & ListOptions): Promise<{ tasks: Task[] }> {
        const q: Record<string, string> = { agent_id: this.requireAgentId(opts?.agentId) };
        if (opts?.status) q.status = opts.status;
        if (opts?.limit) q.limit = String(opts.limit);
        return this.request('GET', '/api/v1/tasks', { query: q });
    }
    async updateTask(id: string, updates: Record<string, unknown>): Promise<Task> { return this.request('PUT', `/api/v1/tasks/${id}`, { body: updates }); }
    async deleteTask(id: string): Promise<void> { await this.request('DELETE', `/api/v1/tasks/${id}`); }

    // --- Events ---
    async storeEvent(data: { title: string; eventType: string; description?: string; severity?: string; outcome?: string; tags?: string[]; agentId?: string }): Promise<Event> {
        return this.request('POST', '/api/v1/events', {
            body: { agent_id: this.requireAgentId(data.agentId), title: data.title, event_type: data.eventType, description: data.description, severity: data.severity, outcome: data.outcome, tags: data.tags },
        });
    }
    async getEvent(id: string): Promise<Event> { return this.request('GET', `/api/v1/events/${id}`); }
    async listEvents(opts?: { agentId?: string; eventType?: string } & ListOptions): Promise<{ events: Event[] }> {
        const q: Record<string, string> = { agent_id: this.requireAgentId(opts?.agentId) };
        if (opts?.eventType) q.event_type = opts.eventType;
        if (opts?.limit) q.limit = String(opts.limit);
        return this.request('GET', '/api/v1/events', { query: q });
    }
    async updateEvent(id: string, updates: Record<string, unknown>): Promise<Event> { return this.request('PUT', `/api/v1/events/${id}`, { body: updates }); }
    async deleteEvent(id: string): Promise<void> { await this.request('DELETE', `/api/v1/events/${id}`); }

    // --- Projects ---
    async storeProject(data: { name: string; description?: string; tags?: string[]; agentId?: string }): Promise<Project> {
        return this.request('POST', '/api/v1/projects', {
            body: { agent_id: this.requireAgentId(data.agentId), name: data.name, description: data.description, tags: data.tags },
        });
    }
    async getProject(id: string): Promise<Project> { return this.request('GET', `/api/v1/projects/${id}`); }
    async listProjects(opts?: { agentId?: string } & ListOptions): Promise<{ projects: Project[] }> {
        return this.request('GET', '/api/v1/projects', { query: { agent_id: this.requireAgentId(opts?.agentId) } });
    }
    async updateProject(id: string, updates: Record<string, unknown>): Promise<Project> { return this.request('PUT', `/api/v1/projects/${id}`, { body: updates }); }
    async deleteProject(id: string): Promise<void> { await this.request('DELETE', `/api/v1/projects/${id}`); }

    // ============================
    //  Search & Recall
    // ============================

    async search(query: string, opts?: { agentId?: string; limit?: number; threshold?: number }): Promise<{ results: SearchResult[] }> {
        return this.request('POST', '/api/v1/search', {
            body: { query, agent_id: this.requireAgentId(opts?.agentId), limit: opts?.limit, threshold: opts?.threshold },
        });
    }

    async recall(query: string, opts?: RecallOptions & { agentId?: string }): Promise<{ results: RecallResult[]; total: number; weights: Record<string, number> }> {
        return this.request('POST', '/api/v1/recall', {
            body: {
                query,
                agent_id: this.requireAgentId(opts?.agentId),
                types: opts?.types,
                limit: opts?.limit,
                include_related: opts?.includeRelated,
                semantic_weight: opts?.semanticWeight,
                keyword_weight: opts?.keywordWeight,
                recency_weight: opts?.recencyWeight,
            },
        });
    }

    // ============================
    //  Edges (Relationship Graph)
    // ============================

    async createEdge(data: {
        sourceType: string; sourceId: string;
        targetType: string; targetId: string;
        relation: string; weight?: number; metadata?: Record<string, unknown>;
        agentId?: string;
    }): Promise<Edge> {
        return this.request('POST', '/api/v1/edges', {
            body: {
                agent_id: this.requireAgentId(data.agentId),
                source_type: data.sourceType, source_id: data.sourceId,
                target_type: data.targetType, target_id: data.targetId,
                relation: data.relation, weight: data.weight, metadata: data.metadata,
            },
        });
    }

    async listEdges(opts?: { agentId?: string; relation?: string; sourceType?: string; sourceId?: string }): Promise<{ edges: Edge[] }> {
        const q: Record<string, string> = {};
        const aid = opts?.agentId || this.agentId;
        if (aid) q.agent_id = aid;
        if (opts?.relation) q.relation = opts.relation;
        if (opts?.sourceType) q.source_type = opts.sourceType;
        if (opts?.sourceId) q.source_id = opts.sourceId;
        return this.request('GET', '/api/v1/edges', { query: q });
    }

    async getGraph(type: string, id: string, opts?: { agentId?: string }): Promise<{
        node: { type: string; id: string }; outgoing: Edge[]; incoming: Edge[]; total: number;
    }> {
        const q: Record<string, string> = {};
        const aid = opts?.agentId || this.agentId;
        if (aid) q.agent_id = aid;
        return this.request('GET', `/api/v1/edges/graph/${type}/${id}`, { query: q });
    }

    async deleteEdge(id: string): Promise<void> { await this.request('DELETE', `/api/v1/edges/${id}`); }

    // ============================
    //  Decay
    // ============================

    async getDecayStatus(opts?: { agentId?: string }): Promise<DecayStatus> {
        return this.request('GET', '/api/v1/decay/status', { query: { agent_id: this.requireAgentId(opts?.agentId) } });
    }

    async runDecaySweep(opts?: { agentId?: string }): Promise<{ transitioned_to_cooling: number; transitioned_to_archived: number }> {
        return this.request('POST', '/api/v1/decay/sweep', { body: { agent_id: opts?.agentId || this.agentId } });
    }

    // ============================
    //  Convenience: Unified store
    // ============================

    async store(type: 'fact' | 'decision' | 'task' | 'event' | 'project', data: Record<string, unknown>): Promise<unknown> {
        switch (type) {
            case 'fact': return this.storeFact(data as Parameters<typeof this.storeFact>[0]);
            case 'decision': return this.storeDecision(data as Parameters<typeof this.storeDecision>[0]);
            case 'task': return this.storeTask(data as Parameters<typeof this.storeTask>[0]);
            case 'event': return this.storeEvent(data as Parameters<typeof this.storeEvent>[0]);
            case 'project': return this.storeProject(data as Parameters<typeof this.storeProject>[0]);
        }
    }
}
