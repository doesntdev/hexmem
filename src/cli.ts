#!/usr/bin/env node

/**
 * hexmem CLI — command-line interface for the HexMem memory API.
 *
 * Usage:
 *   hexmem search "database patterns" --limit 5
 *   hexmem recall "auth implementation" --types fact,decision
 *   hexmem store fact "pgvector supports HNSW indexes" --tags db,perf
 *   hexmem status --agent my-agent
 *   hexmem stats
 *   hexmem agents
 *   hexmem sessions --agent my-agent
 *   hexmem decay sweep
 */

import { HexMem, HexMemError } from '../sdk/index.js';

// ---- Config ----

const BASE_URL = process.env.HEXMEM_URL || 'http://localhost:3400';
const API_KEY = process.env.HEXMEM_API_KEY || process.env.HEXMEM_KEY || 'hexmem_dev_key';
const DEFAULT_AGENT = process.env.HEXMEM_AGENT || '';

function createClient(agentId?: string) {
    return new HexMem({
        baseUrl: BASE_URL,
        apiKey: API_KEY,
        agentId: agentId || DEFAULT_AGENT || undefined,
    });
}

// ---- Formatting Helpers ----

const COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    white: '\x1b[37m',
};

function c(color: keyof typeof COLORS, text: string): string {
    return `${COLORS[color]}${text}${COLORS.reset}`;
}

function typeColor(type: string): string {
    const map: Record<string, keyof typeof COLORS> = {
        fact: 'cyan', decision: 'magenta', task: 'yellow',
        event: 'red', project: 'green', session_message: 'blue',
    };
    return c(map[type] || 'white', type);
}

function truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.slice(0, max - 1) + '…';
}

function formatScore(score: number): string {
    const pct = Math.round(score * 100);
    if (pct >= 70) return c('green', `${pct}%`);
    if (pct >= 40) return c('yellow', `${pct}%`);
    return c('dim', `${pct}%`);
}

// ---- Argument Parsing ----

function parseArgs(argv: string[]) {
    const args: string[] = [];
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) {
                flags[key] = next;
                i++;
            } else {
                flags[key] = 'true';
            }
        } else {
            args.push(a);
        }
    }
    return { args, flags };
}

// ---- Commands ----

async function cmdSearch(mem: HexMem, query: string, flags: Record<string, string>) {
    const limit = parseInt(flags.limit || '10', 10);
    const { results } = await mem.search(query, { limit });

    if (results.length === 0) {
        console.log(c('dim', 'No results found.'));
        return;
    }

    console.log(c('bold', `\n🔍 Search: "${query}" — ${results.length} results\n`));
    for (const r of results) {
        const sim = formatScore(r.similarity);
        console.log(`  ${typeColor(r.type).padEnd(25)} ${sim}  ${truncate(r.content, 80)}`);
    }
    console.log();
}

async function cmdRecall(mem: HexMem, query: string, flags: Record<string, string>) {
    const limit = parseInt(flags.limit || '10', 10);
    const types = flags.types?.split(',');
    const result = await mem.recall(query, { types, limit, includeRelated: true });

    if (result.total === 0) {
        console.log(c('dim', 'No results found.'));
        return;
    }

    console.log(c('bold', `\n🧠 Recall: "${query}" — ${result.total} results`));
    console.log(c('dim', `   weights: sem=${result.weights.semantic} kw=${result.weights.keyword} rec=${result.weights.recency}\n`));

    for (const r of result.results) {
        const score = formatScore(r.score);
        const signals = [
            r.signals.semantic ? `sem=${(r.signals.semantic * 100).toFixed(0)}` : null,
            r.signals.keyword ? `kw=${(r.signals.keyword * 100).toFixed(0)}` : null,
            r.signals.recency ? `rec=${(r.signals.recency * 100).toFixed(0)}` : null,
        ].filter(Boolean).join(' ');
        console.log(`  ${typeColor(r.type).padEnd(25)} ${score}  ${c('dim', signals)}`);
        console.log(`  ${' '.repeat(16)} ${truncate(r.content, 90)}`);
        if (r.related && r.related.length > 0) {
            for (const rel of r.related.slice(0, 3)) {
                const relMeta = rel.metadata as { relation?: string };
                console.log(`  ${' '.repeat(16)} ${c('dim', '└─')} ${typeColor(rel.type)} ${c('dim', relMeta.relation || '')} ${truncate(rel.content, 60)}`);
            }
        }
        console.log();
    }
}

async function cmdStore(mem: HexMem, type: string, content: string, flags: Record<string, string>) {
    const tags = flags.tags?.split(',').map(t => t.trim());
    const result = await mem.store(type as 'fact' | 'decision' | 'task' | 'event' | 'project', {
        content,
        title: content,
        name: content,
        description: flags.description,
        decision: content,
        rationale: flags.rationale,
        eventType: flags.type || 'discovery',
        severity: flags.severity || 'info',
        priority: flags.priority ? parseInt(flags.priority, 10) : undefined,
        tags,
    });
    console.log(c('green', `✓ Stored ${type}: `) + c('bold', (result as { id: string }).id));
}

async function cmdStatus(mem: HexMem) {
    const agent = await mem.getAgent();
    const decay = await mem.getDecayStatus();

    console.log(c('bold', `\n📊 Agent: ${agent.display_name}`) + c('dim', ` (${agent.slug})`));
    console.log(c('dim', `   ID: ${agent.id}\n`));

    // Core memory
    const coreKeys = Object.keys(agent.core_memory);
    if (coreKeys.length > 0) {
        console.log(c('bold', '  Core Memory:'));
        for (const key of coreKeys) {
            console.log(`    ${c('cyan', key)}: ${JSON.stringify(agent.core_memory[key])}`);
        }
        console.log();
    }

    // Decay status
    console.log(c('bold', '  Memory Status:'));
    console.log(`    ${'Table'.padEnd(20)} ${'Active'.padEnd(10)} ${'Cooling'.padEnd(10)} ${'Archived'.padEnd(10)}`);
    console.log(`    ${'─'.repeat(50)}`);
    for (const [table, counts] of Object.entries(decay.status)) {
        const s = counts as { active: number; cooling: number; archived: number };
        console.log(`    ${table.padEnd(20)} ${c('green', String(s.active).padEnd(10))} ${c('yellow', String(s.cooling).padEnd(10))} ${c('dim', String(s.archived).padEnd(10))}`);
    }
    console.log();
}

async function cmdStats(mem: HexMem) {
    const { agents } = await mem.listAgents();

    console.log(c('bold', `\n📈 HexMem Stats — ${agents.length} agents\n`));
    for (const agent of agents) {
        const a = agent as Agent & { stats?: Record<string, number> };
        // Re-fetch with stats
        const full = await mem.getAgent(agent.id) as Agent & { stats?: Record<string, number> };
        console.log(`  ${c('cyan', full.display_name)} ${c('dim', `(${full.slug})`)}`);
        if (full.stats) {
            const parts = Object.entries(full.stats)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${k}: ${c('bold', String(v))}`);
            if (parts.length > 0) console.log(`    ${parts.join('  |  ')}`);
        }
    }
    console.log();
}

async function cmdAgents(mem: HexMem) {
    const { agents } = await mem.listAgents();
    console.log(c('bold', `\n🤖 Agents (${agents.length})\n`));
    for (const a of agents) {
        console.log(`  ${c('cyan', a.slug.padEnd(25))} ${a.display_name}  ${c('dim', a.id)}`);
    }
    console.log();
}

async function cmdSessions(mem: HexMem, flags: Record<string, string>) {
    const limit = parseInt(flags.limit || '10', 10);
    const { sessions } = await mem.listSessions({ limit });
    console.log(c('bold', `\n💬 Sessions (${sessions.length})\n`));
    for (const s of sessions) {
        const status = s.ended_at ? c('dim', 'ended') : c('green', 'active');
        const summary = s.summary ? truncate(s.summary, 80) : c('dim', 'no summary');
        console.log(`  ${status.padEnd(20)} ${c('dim', s.id.slice(0, 8))}  ${summary}`);
    }
    console.log();
}

async function cmdDecay(mem: HexMem, sub: string) {
    if (sub === 'sweep') {
        const result = await mem.runDecaySweep();
        console.log(c('bold', '\n🧹 Decay Sweep Results\n'));
        console.log(`  Transitioned to cooling:  ${c('yellow', String(result.transitioned_to_cooling))}`);
        console.log(`  Transitioned to archived: ${c('dim', String(result.transitioned_to_archived))}`);
        console.log();
    } else {
        const status = await mem.getDecayStatus();
        console.log(c('bold', '\n⏳ Decay Status\n'));
        for (const [table, counts] of Object.entries(status.status)) {
            const s = counts as { active: number; cooling: number; archived: number };
            console.log(`  ${table.padEnd(20)} active=${c('green', String(s.active))}  cooling=${c('yellow', String(s.cooling))}  archived=${c('dim', String(s.archived))}`);
        }
        console.log();
    }
}

// ---- Help ----

function printHelp() {
    console.log(`
${c('bold', 'hexmem')} — HexMem Memory CLI

${c('bold', 'Usage:')}
  hexmem search <query>              Search memories by semantic similarity
  hexmem recall <query>              Hybrid recall (semantic + keyword + recency)
  hexmem store <type> <content>      Store a memory (fact|decision|task|event|project)
  hexmem status                      Show agent status and memory counts
  hexmem stats                       Show all agents and their stats
  hexmem agents                      List all agents
  hexmem sessions                    List recent sessions
  hexmem decay [sweep]               Show decay status or run sweep

${c('bold', 'Flags:')}
  --agent <slug|id>     Agent to operate on (or set HEXMEM_AGENT env var)
  --limit <n>           Max results (default: 10)
  --types <a,b,c>       Filter by memory type (fact,decision,task,event,session_message)
  --tags <a,b>          Tags for store command
  --priority <n>        Priority for tasks (1-100)
  --description <text>  Description for store command

${c('bold', 'Environment:')}
  HEXMEM_URL        API base URL (default: http://localhost:3400)
  HEXMEM_API_KEY    API key (default: hexmem_dev_key)
  HEXMEM_AGENT      Default agent slug
`);
}

// ---- Import for stats type ----
import type { Agent } from '../sdk/types.js';

// ---- Main ----

async function main() {
    const { args, flags } = parseArgs(process.argv.slice(2));
    const command = args[0];

    if (!command || command === 'help' || flags.help) {
        printHelp();
        process.exit(0);
    }

    let mem = createClient(flags.agent);

    // Commands that need an agent_id — auto-resolve slug to UUID
    const needsAgent = ['search', 'recall', 'store', 'status', 'sessions', 'decay'];
    if (needsAgent.includes(command) && (flags.agent || DEFAULT_AGENT)) {
        try {
            const resolvedId = await mem.resolveAgentId();
            mem = createClient(resolvedId);
        } catch {
            // If resolution fails, continue with the raw value
        }
    }

    try {
        switch (command) {
            case 'search':
                if (!args[1]) { console.error(c('red', 'Usage: hexmem search <query>')); process.exit(1); }
                await cmdSearch(mem, args[1], flags);
                break;
            case 'recall':
                if (!args[1]) { console.error(c('red', 'Usage: hexmem recall <query>')); process.exit(1); }
                await cmdRecall(mem, args[1], flags);
                break;
            case 'store':
                if (!args[1] || !args[2]) { console.error(c('red', 'Usage: hexmem store <type> <content>')); process.exit(1); }
                await cmdStore(mem, args[1], args[2], flags);
                break;
            case 'status':
                await cmdStatus(mem);
                break;
            case 'stats':
                await cmdStats(mem);
                break;
            case 'agents':
                await cmdAgents(mem);
                break;
            case 'sessions':
                await cmdSessions(mem, flags);
                break;
            case 'decay':
                await cmdDecay(mem, args[1] || 'status');
                break;
            default:
                console.error(c('red', `Unknown command: ${command}`));
                printHelp();
                process.exit(1);
        }
    } catch (err) {
        if (err instanceof HexMemError) {
            console.error(c('red', `API Error ${err.status}: ${err.message}`));
            process.exit(1);
        }
        throw err;
    }
}

main();
