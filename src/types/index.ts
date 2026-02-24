// TypeScript interfaces for all HexMem entities

export interface Agent {
    id: string;
    slug: string;
    display_name: string;
    description: string | null;
    core_memory: Record<string, unknown>;
    config: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}

export interface Session {
    id: string;
    agent_id: string;
    external_id: string | null;
    metadata: Record<string, unknown>;
    started_at: Date;
    ended_at: Date | null;
    summary: string | null;
}

export interface SessionMessage {
    id: string;
    session_id: string;
    agent_id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    embedding: number[] | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    access_count: number;
    last_accessed_at: Date | null;
    decay_status: 'active' | 'cooling' | 'archived';
}

export interface Project {
    id: string;
    agent_id: string;
    slug: string;
    name: string;
    description: string | null;
    status: 'active' | 'paused' | 'completed' | 'archived';
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}

export interface Task {
    id: string;
    agent_id: string;
    project_id: string | null;
    title: string;
    description: string | null;
    status: 'not_started' | 'in_progress' | 'blocked' | 'complete' | 'cancelled';
    priority: number;
    assignee: string | null;
    due_date: string | null;
    blocked_by: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
    embedding: number[] | null;
    created_at: Date;
    updated_at: Date;
    completed_at: Date | null;
    access_count: number;
    last_accessed_at: Date | null;
    decay_status: 'active' | 'cooling' | 'archived';
}

export interface Fact {
    id: string;
    agent_id: string;
    content: string;
    subject: string | null;
    confidence: number;
    source: string | null;
    tags: string[];
    verified: boolean;
    valid_from: Date;
    valid_until: Date | null;
    superseded_by: string | null;
    embedding: number[] | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
    access_count: number;
    last_accessed_at: Date | null;
    decay_status: 'active' | 'cooling' | 'archived';
}

export interface Decision {
    id: string;
    agent_id: string;
    project_id: string | null;
    title: string;
    decision: string;
    rationale: string;
    alternatives: Array<{ option: string; reason_rejected: string }>;
    context: string | null;
    session_id: string | null;
    tags: string[];
    embedding: number[] | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    access_count: number;
    last_accessed_at: Date | null;
    decay_status: 'active' | 'cooling' | 'archived';
}

export interface HexMemEvent {
    id: string;
    agent_id: string;
    project_id: string | null;
    title: string;
    event_type: 'incident' | 'milestone' | 'release' | 'discovery' | 'blocker' | 'resolution';
    description: string | null;
    outcome: string | null;
    caused_by: string | null;
    severity: 'info' | 'warning' | 'critical';
    tags: string[];
    embedding: number[] | null;
    metadata: Record<string, unknown>;
    occurred_at: Date;
    resolved_at: Date | null;
    access_count: number;
    last_accessed_at: Date | null;
    decay_status: 'active' | 'cooling' | 'archived';
}

export interface MemoryEdge {
    id: string;
    agent_id: string;
    source_type: string;
    source_id: string;
    target_type: string;
    target_id: string;
    relation: string;
    weight: number;
    metadata: Record<string, unknown>;
    created_at: Date;
}

export interface ApiKey {
    id: string;
    key_hash: string;
    key_prefix: string;
    name: string;
    agent_id: string | null;
    permissions: string[];
    rate_limit: number;
    expires_at: Date | null;
    last_used_at: Date | null;
    created_at: Date;
    revoked_at: Date | null;
}

export interface DecayPolicy {
    id: string;
    agent_id: string | null;
    memory_type: string;
    ttl_days: number | null;
    access_boost: boolean;
    min_accesses: number;
    created_at: Date;
}

// Embedding provider interface
export interface EmbeddingProvider {
    readonly name: string;
    readonly dimensions: number;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingConfig {
    provider: 'gemini' | 'openai' | 'ollama';
    geminiApiKey?: string;
    openaiApiKey?: string;
    ollamaUrl?: string;
    ollamaModel?: string;
}

// Auth context attached to requests
export interface AuthContext {
    keyId: string;
    agentId: string | null;  // null = global access
    permissions: string[];
}
