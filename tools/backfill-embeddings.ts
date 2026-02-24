/**
 * backfill-embeddings.ts
 *
 * Backfill embeddings for all rows missing them in HexMem.
 * Uses Gemini batch embedding API with rate limiting.
 *
 * Usage:
 *   npx tsx tools/backfill-embeddings.ts [--table facts] [--limit 500] [--agent my-agent]
 */

import pg from 'pg';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const { Pool } = pg;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const BATCH_SIZE = 20;
const DELAY_MS = 250; // Between batches

// Tables and their text content columns
const TABLE_CONFIG: Record<string, { contentCol: string; textBuilder: (row: Record<string, unknown>) => string }> = {
    facts: {
        contentCol: 'content',
        textBuilder: (r) => r.content as string,
    },
    decisions: {
        contentCol: 'title',
        textBuilder: (r) => `${r.title}: ${r.decision || ''}`,
    },
    tasks: {
        contentCol: 'title',
        textBuilder: (r) => `${r.title}${r.description ? ': ' + r.description : ''}`,
    },
    events: {
        contentCol: 'title',
        textBuilder: (r) => `${r.title}${r.description ? ': ' + r.description : ''}`,
    },
};

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
    if (!GEMINI_API_KEY || !DATABASE_URL) {
        console.error('Required: GEMINI_API_KEY and DATABASE_URL');
        process.exit(1);
    }

    // Parse args
    const args = process.argv.slice(2);
    const tableArg = args.indexOf('--table') >= 0 ? args[args.indexOf('--table') + 1] : null;
    const limitArg = args.indexOf('--limit') >= 0 ? parseInt(args[args.indexOf('--limit') + 1], 10) : 10000;
    const agentArg = args.indexOf('--agent') >= 0 ? args[args.indexOf('--agent') + 1] : null;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const pool = new Pool({ connectionString: DATABASE_URL });

    // Resolve agent slug to ID if needed
    let agentFilter = '';
    const queryParams: unknown[] = [];
    if (agentArg) {
        const { rows } = await pool.query(
            'SELECT id FROM agents WHERE slug = $1 OR id::text = $1',
            [agentArg]
        );
        if (rows.length === 0) {
            console.error(`Agent not found: ${agentArg}`);
            process.exit(1);
        }
        agentFilter = 'AND agent_id = $1';
        queryParams.push(rows[0].id);
        console.log(`Filtering to agent: ${agentArg} (${rows[0].id})`);
    }

    const tables = tableArg ? [tableArg] : Object.keys(TABLE_CONFIG);
    let totalEmbedded = 0;
    let totalErrors = 0;

    for (const table of tables) {
        const config = TABLE_CONFIG[table];
        if (!config) {
            console.error(`Unknown table: ${table}`);
            continue;
        }

        // Count rows needing embeddings
        const countQuery = `SELECT COUNT(*) FROM ${table} WHERE embedding IS NULL ${agentFilter}`;
        const { rows: countRows } = await pool.query(countQuery, queryParams);
        const total = Math.min(parseInt(countRows[0].count, 10), limitArg);

        if (total === 0) {
            console.log(`\n${table}: 0 rows need embeddings ✓`);
            continue;
        }

        console.log(`\n━━━ ${table}: ${total} rows need embeddings ━━━`);

        // Fetch rows in batches
        let offset = 0;
        let processed = 0;

        while (processed < total) {
            const batchLimit = Math.min(BATCH_SIZE, total - processed);
            const paramOffset = queryParams.length;
            const fetchQuery = `
                SELECT id, ${config.contentCol}${table === 'decisions' ? ', decision' : ''}${table !== 'facts' && table !== 'decisions' ? ', description' : ''}
                FROM ${table}
                WHERE embedding IS NULL ${agentFilter}
                ORDER BY created_at
                LIMIT $${paramOffset + 1} OFFSET $${paramOffset + 2}
            `;

            const { rows } = await pool.query(fetchQuery, [...queryParams, batchLimit, offset]);
            if (rows.length === 0) break;

            // Build texts
            const texts = rows.map(r => config.textBuilder(r as Record<string, unknown>));

            try {
                // Batch embed
                const result = await model.batchEmbedContents({
                    requests: texts.map(text => ({
                        content: { parts: [{ text }], role: 'user' },
                        outputDimensionality: 768,
                    })),
                });

                // Update each row
                for (let i = 0; i < rows.length; i++) {
                    const embStr = `[${result.embeddings[i].values.join(',')}]`;
                    await pool.query(
                        `UPDATE ${table} SET embedding = $1::vector WHERE id = $2`,
                        [embStr, rows[i].id]
                    );
                }

                processed += rows.length;
                totalEmbedded += rows.length;
                offset += rows.length;

                const pct = Math.round((processed / total) * 100);
                process.stdout.write(`\r  ${processed}/${total} (${pct}%)`);

                await sleep(DELAY_MS);
            } catch (err) {
                const msg = (err as Error).message;
                if (msg.includes('429') || msg.includes('rate')) {
                    console.log(`\n  ⏳ Rate limited, waiting 5s...`);
                    await sleep(5000);
                    // Don't increment offset — retry
                } else {
                    console.error(`\n  ❌ Batch error: ${msg}`);
                    totalErrors++;
                    offset += rows.length; // Skip this batch
                    processed += rows.length;
                }
            }
        }

        console.log(`\n  ✓ ${processed} embedded`);
    }

    console.log(`\n${'═'.repeat(40)}`);
    console.log(`✅ Backfill complete: ${totalEmbedded} embedded, ${totalErrors} errors`);

    await pool.end();
}

main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
