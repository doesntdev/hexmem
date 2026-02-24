import { query } from '../db/connection.js';
import { runDecaySweep } from './decay.js';

/**
 * Background job scheduler for periodic maintenance tasks:
 * - Decay sweeps (transition items through active → cooling → archived)
 * - Query logging cleanup
 *
 * Uses simple setInterval — no external job runner needed.
 */

interface JobConfig {
    decaySweepIntervalMs: number;
    queryLogRetentionDays: number;
    enabled: boolean;
}

const DEFAULT_CONFIG: JobConfig = {
    decaySweepIntervalMs: 60 * 60 * 1000, // 1 hour
    queryLogRetentionDays: 30,
    enabled: true,
};

let intervals: NodeJS.Timeout[] = [];

export function startBackgroundJobs(config: Partial<JobConfig> = {}): void {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    if (!cfg.enabled) return;

    console.log('[jobs] Starting background job scheduler');

    // Decay sweep
    intervals.push(
        setInterval(async () => {
            try {
                const stats = await runDecaySweep();
                if (stats.transitioned_to_cooling > 0 || stats.transitioned_to_archived > 0) {
                    console.log(`[jobs] Decay sweep: ${stats.transitioned_to_cooling} → cooling, ${stats.transitioned_to_archived} → archived`);
                }
            } catch (err) {
                console.error('[jobs] Decay sweep failed:', (err as Error).message);
            }
        }, cfg.decaySweepIntervalMs)
    );

    // Query log cleanup
    intervals.push(
        setInterval(async () => {
            try {
                const { rowCount } = await query(
                    `DELETE FROM query_log WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
                    [cfg.queryLogRetentionDays]
                );
                if (rowCount && rowCount > 0) {
                    console.log(`[jobs] Cleaned ${rowCount} old query log entries`);
                }
            } catch {
                // query_log table may not exist yet — ignore
            }
        }, 6 * 60 * 60 * 1000) // every 6 hours
    );
}

export function stopBackgroundJobs(): void {
    for (const interval of intervals) clearInterval(interval);
    intervals = [];
    console.log('[jobs] Stopped background jobs');
}
