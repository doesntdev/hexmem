/**
 * SDK type definitions — mirrors the HexMem API response shapes.
 */

export interface HexMemConfig {
    /** HexMem API base URL (e.g., 'http://localhost:3400') */
    baseUrl: string;
    /** API key for authentication */
    apiKey: string;
    /** Default agent ID/slug — used when not specified per-call */
    agentId?: string;
}

// ---- Core Entities ----

export interface Agent {
    id: string;
    slug: string;
    display_name: string;
    description: string | null;
    core_memory: Record<string, unknown>;
    config: Record<string, unknown>;
    created_at: string;
}

export interface Session {
    id: string;
    agent_id: string;
    external_id: string | null;
    summary: string | null;
    metadata: Record<string, unknown>;
    started_at: string;
    ended_at: string | null;
}

export interface Message {
    id: string;
    session_id: string;
    agent_id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface Fact {
    id: string;
    agent_id: string;
    content: string;
    subject: string | null;
    confidence: number;
    source: string | null;
    tags: string[];
    access_count: number;
    decay_status: string;
    created_at: string;
}

export interface Decision {
    id: string;
    agent_id: string;
    title: string;
    decision: string;
    rationale: string | null;
    alternatives: string;
    session_id: string | null;
    tags: string[];
    access_count: number;
    decay_status: string;
    created_at: string;
}

export interface Task {
    id: string;
    agent_id: string;
    project_id: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: number;
    tags: string[];
    access_count: number;
    decay_status: string;
    created_at: string;
}

export interface Event {
    id: string;
    agent_id: string;
    title: string;
    event_type: string;
    description: string | null;
    severity: string;
    outcome: string | null;
    tags: string[];
    access_count: number;
    decay_status: string;
    occurred_at: string;
}

export interface Project {
    id: string;
    agent_id: string;
    name: string;
    slug: string;
    description: string | null;
    status: string;
    tags: string[];
    created_at: string;
}

export interface Edge {
    id: string;
    agent_id: string;
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    relation: string;
    weight: number;
    metadata: Record<string, unknown>;
    created_at: string;
}

// ---- Query/Response Types ----

export interface ListOptions {
    limit?: number;
    offset?: number;
}

export interface RecallOptions extends ListOptions {
    types?: string[];
    includeRelated?: boolean;
    semanticWeight?: number;
    keywordWeight?: number;
    recencyWeight?: number;
}

export interface RecallResult {
    id: string;
    type: string;
    content: string;
    score: number;
    signals: {
        semantic?: number;
        keyword?: number;
        recency?: number;
        graph_boost?: number;
    };
    metadata: Record<string, unknown>;
    created_at: string;
    related?: RecallResult[];
}

export interface SearchResult {
    id: string;
    type: string;
    content: string;
    similarity: number;
}

export interface DecayStatus {
    status: Record<string, { active: number; cooling: number; archived: number }>;
    policies: unknown[];
}
