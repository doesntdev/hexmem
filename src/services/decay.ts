import { query } from '../db/connection.js';

/**
 * Memory Decay Engine
 *
 * TTL-based decay with configurable policies per memory type and agent.
 * Decay lifecycle: active → cooling → archived
 */

const MEMORY_TABLES = ['facts', 'decisions', 'tasks', 'events', 'session_messages'] as const;

// Map table names to decay_policies memory_type values
const TABLE_TO_TYPE: Record<string, string> = {
    facts: 'fact',
    decisions: 'decision',
    tasks: 'task',
    events: 'event',
    session_messages: 'session_message',
};

// Each table has different timestamp columns — map them
const TABLE_TIMESTAMPS: Record<string, { created: string; updated: string }> = {
    facts: { created: 'created_at', updated: 'updated_at' },
    decisions: { created: 'created_at', updated: 'created_at' }, // no updated_at
    tasks: { created: 'created_at', updated: 'updated_at' },
    events: { created: 'occurred_at', updated: 'occurred_at' }, // uses occurred_at
    session_messages: { created: 'created_at', updated: 'created_at' },
};

interface DecayStats {
    transitioned_to_cooling: number;
    transitioned_to_archived: number;
    immune_items: number;
}

/**
 * Run a decay sweep across all memory tables.
 * Called periodically (e.g., via cron or on-demand).
 */
export async function runDecaySweep(agentId?: string): Promise<DecayStats> {
    const stats: DecayStats = {
        transitioned_to_cooling: 0,
        transitioned_to_archived: 0,
        immune_items: 0,
    };

    for (const table of MEMORY_TABLES) {
        const memType = TABLE_TO_TYPE[table];

        // Get applicable decay policy
        const { rows: policies } = await query<{
            ttl_days: number | null; min_accesses: number; access_boost: boolean;
        }>(
            `SELECT ttl_days, min_accesses, access_boost
       FROM decay_policies
       WHERE memory_type = $1
         AND (agent_id = $2 OR agent_id IS NULL)
       ORDER BY agent_id NULLS LAST
       LIMIT 1`,
            [memType, agentId]
        );

        if (policies.length === 0 || policies[0].ttl_days === null) continue;

        const policy = policies[0];
        const ts = TABLE_TIMESTAMPS[table];
        const agentFilter = agentId ? 'AND agent_id = $3' : '';
        const params: unknown[] = [policy.min_accesses, policy.ttl_days];
        if (agentId) params.push(agentId);

        // Transition: active → cooling (items not accessed within TTL)
        const { rowCount: toCooling } = await query(
            `UPDATE ${table}
       SET decay_status = 'cooling'
       WHERE decay_status = 'active'
         ${agentFilter}
         AND access_count < $1
         AND (last_accessed_at IS NULL AND ${ts.created} < NOW() - INTERVAL '1 day' * $2
              OR last_accessed_at < NOW() - INTERVAL '1 day' * $2)`,
            params
        );
        stats.transitioned_to_cooling += toCooling ?? 0;

        // Transition: cooling → archived (items cooling for > 30 days)
        const archiveParams: unknown[] = [];
        if (agentId) archiveParams.push(agentId);

        const { rowCount: toArchived } = await query(
            `UPDATE ${table}
       SET decay_status = 'archived'
       WHERE decay_status = 'cooling'
         ${agentId ? 'AND agent_id = $1' : ''}
         AND ${ts.updated} < NOW() - INTERVAL '30 days'`,
            archiveParams
        );
        stats.transitioned_to_archived += toArchived ?? 0;

        // Count immune items (high access count)
        const immuneParams: unknown[] = [policy.min_accesses];
        if (agentId) immuneParams.push(agentId);

        const { rows: immuneRows } = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM ${table}
       WHERE decay_status = 'active'
         ${agentId ? 'AND agent_id = $2' : ''}
         AND access_count >= $1`,
            immuneParams
        );
        stats.immune_items += parseInt(immuneRows[0].count, 10);
    }

    return stats;
}

/**
 * Manually revive an archived/cooling item back to active.
 */
export async function reviveItem(
    table: string,
    itemId: string
): Promise<boolean> {
    if (!MEMORY_TABLES.includes(table as typeof MEMORY_TABLES[number])) {
        throw new Error(`Invalid table: ${table}`);
    }

    const { rowCount } = await query(
        `UPDATE ${table}
     SET decay_status = 'active', access_count = access_count + 1, last_accessed_at = NOW()
     WHERE id = $1 AND decay_status IN ('cooling', 'archived')`,
        [itemId]
    );

    return (rowCount ?? 0) > 0;
}
