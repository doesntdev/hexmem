import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from './connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

export async function runMigrations(): Promise<string[]> {
    // Ensure _migrations table exists (001_extensions.sql creates it,
    // but we need a bootstrap for the very first run)
    await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

    // Get already-applied migrations
    const { rows: applied } = await query<{ name: string }>(
        'SELECT name FROM _migrations ORDER BY name'
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    // Read migration files
    const files = await readdir(MIGRATIONS_DIR);
    const sqlFiles = files
        .filter((f) => f.endsWith('.sql'))
        .sort();

    const newlyApplied: string[] = [];

    for (const file of sqlFiles) {
        if (appliedSet.has(file)) continue;

        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
        console.log(`[migrate] Applying: ${file}`);

        try {
            await query('BEGIN');
            await query(sql);
            await query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
            await query('COMMIT');
            newlyApplied.push(file);
            console.log(`[migrate] Applied: ${file}`);
        } catch (err) {
            await query('ROLLBACK');
            console.error(`[migrate] Failed: ${file}`, err);
            throw err;
        }
    }

    if (newlyApplied.length === 0) {
        console.log('[migrate] All migrations up to date');
    } else {
        console.log(`[migrate] Applied ${newlyApplied.length} migration(s)`);
    }

    return newlyApplied;
}

// Run directly: tsx src/db/migrate.ts
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''))) {
    runMigrations()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}
