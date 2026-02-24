#!/usr/bin/env npx tsx
/**
 * setup-openclaw.ts
 *
 * One-command integration of HexMem with OpenClaw:
 *   1. Verifies HexMem is running
 *   2. Creates HexMem agents for each OpenClaw agent
 *   3. Installs the plugin to ~/.openclaw/extensions/hexmem/
 *   4. Updates openclaw.json (plugins, tools, slots)
 *   5. Updates agent MEMORY.md files
 *
 * Usage:
 *   npx tsx tools/setup-openclaw.ts --agents agent1,agent2,agent3
 *   npx tsx tools/setup-openclaw.ts --check        # verify only, no changes
 *   npx tsx tools/setup-openclaw.ts --hexmem-url http://localhost:3400
 */

import * as fs from "fs";
import * as path from "path";

const HEXMEM_URL = getArg("--hexmem-url") || process.env.HEXMEM_URL || "http://localhost:3400";
const HEXMEM_KEY = getArg("--hexmem-key") || process.env.HEXMEM_API_KEY || process.env.HEXMEM_DEV_KEY || "hexmem_dev_key";
const CHECK_ONLY = process.argv.includes("--check");
const OPENCLAW_HOME = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "~", ".openclaw");
const OPENCLAW_JSON = path.join(OPENCLAW_HOME, "openclaw.json");
const EXTENSIONS_DIR = path.join(OPENCLAW_HOME, "extensions");
const PLUGIN_SRC = path.resolve(import.meta.dirname || __dirname, "../openclaw-plugin");

// Agent list — pass via --agents flag or defaults to empty (will prompt)
const agentArg = getArg("--agents");
const AGENTS: string[] = agentArg ? agentArg.split(",").map(s => s.trim()).filter(Boolean) : [];

function getArg(name: string): string | undefined {
    const idx = process.argv.indexOf(name);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function log(icon: string, msg: string) {
    console.log(`${icon}  ${msg}`);
}

async function hexmemFetch(reqPath: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${HEXMEM_URL}${reqPath}`, {
        ...opts,
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${HEXMEM_KEY}`,
            ...(opts.headers as Record<string, string> || {}),
        },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${body.slice(0, 200)}`);
    try { return JSON.parse(body); } catch { return body; }
}

// ================================================================
// Step 1: Verify HexMem is running
// ================================================================
async function verifyHexMem(): Promise<boolean> {
    log("🔍", `Checking HexMem at ${HEXMEM_URL}...`);
    try {
        const health = await hexmemFetch("/health");
        log("✅", `HexMem is running (status: ${health.status || "ok"})`);
        return true;
    } catch (err: any) {
        log("❌", `HexMem not reachable: ${err.message}`);
        log("💡", "Start HexMem first: npm run dev");
        return false;
    }
}

// ================================================================
// Step 2: Create HexMem agents
// ================================================================
async function createAgents(): Promise<Map<string, string>> {
    log("👥", "Setting up HexMem agents for OpenClaw...");
    const agentMap = new Map<string, string>();

    for (const slug of AGENTS) {
        try {
            // Try to get existing agent
            const agent = await hexmemFetch(`/api/v1/agents/${slug}`);
            agentMap.set(slug, agent.id);
            log("  ✓", `${slug}: ${agent.id} (existing)`);
        } catch {
            if (CHECK_ONLY) {
                log("  ⚠", `${slug}: not found (would create)`);
                continue;
            }
            // Create
            try {
                const agent = await hexmemFetch("/api/v1/agents", {
                    method: "POST",
                    body: JSON.stringify({
                        slug,
                        display_name: slug.charAt(0).toUpperCase() + slug.slice(1) + " Agent",
                        description: `OpenClaw agent: ${slug}`,
                        core_memory: { source: "openclaw", integrated_at: new Date().toISOString() },
                    }),
                });
                agentMap.set(slug, agent.id);
                log("  ✓", `${slug}: ${agent.id} (created)`);
            } catch (err: any) {
                log("  ❌", `${slug}: failed to create — ${err.message}`);
            }
        }
    }

    return agentMap;
}

// ================================================================
// Step 3: Install plugin
// ================================================================
function installPlugin(): void {
    log("📦", "Installing HexMem plugin...");

    const targetDir = path.join(EXTENSIONS_DIR, "hexmem");

    if (CHECK_ONLY) {
        const exists = fs.existsSync(targetDir);
        log(exists ? "  ✓" : "  ⚠", exists ? "Plugin already installed" : "Plugin not installed (would install)");
        return;
    }

    // Replaces any existing memory plugin with REST API access to HexMem.
    const oldMemoryPluginDir = path.join(EXTENSIONS_DIR, "hexkit-memory"); // legacy plugin cleanup
    if (fs.existsSync(oldMemoryPluginDir)) {
        const backupDir = oldMemoryPluginDir + ".bak." + Date.now();
        fs.renameSync(oldMemoryPluginDir, backupDir);
        log("  📁", `Backed up old memory plugin → ${path.basename(backupDir)}`);
    }

    // Copy plugin files
    fs.mkdirSync(targetDir, { recursive: true });
    const filesToCopy = ["index.ts", "openclaw.plugin.json", "package.json"];
    for (const file of filesToCopy) {
        const src = path.join(PLUGIN_SRC, file);
        const dst = path.join(targetDir, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
        }
    }

    log("  ✓", `Plugin installed to ${targetDir}`);
}

// ================================================================
// Step 4: Update openclaw.json
// ================================================================
function updateOpenClawJson(): void {
    log("⚙️", "Updating openclaw.json...");

    if (!fs.existsSync(OPENCLAW_JSON)) {
        log("  ❌", `Not found: ${OPENCLAW_JSON}`);
        return;
    }

    const config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, "utf-8"));
    let changed = false;

    // 4a: Update plugins.allow — remove any legacy memory plugin, ensure hexmem
    if (Array.isArray(config.plugins?.allow)) {
        let allow = config.plugins.allow as string[];
        const originalAllow = [...allow];

        // Remove hexkit-memory if present
        allow = allow.filter(p => p !== "hexkit-memory");

        // Ensure hexmem is present
        if (!allow.includes("hexmem")) {
            allow.push("hexmem");
        }

        if (JSON.stringify(originalAllow) !== JSON.stringify(allow)) {
            config.plugins.allow = allow;
            changed = true;
        }
    } else {
        config.plugins = config.plugins || {};
        config.plugins.allow = ["hexmem"];
        changed = true;
    }

    // 4b: Set plugins.slots.memory
    config.plugins.slots = config.plugins.slots || {};
    if (config.plugins.slots.memory !== "hexmem") {
        config.plugins.slots.memory = "hexmem";
        changed = true;
    }

    // 4c: Set plugins.entries.hexmem (always update to ensure correct values)
    config.plugins.entries = config.plugins.entries || {};
    const currentHexmem = config.plugins.entries.hexmem || {};
    const correctConfig = {
        enabled: true,
        ...currentHexmem,
        config: {
            url: HEXMEM_URL,
            apiKey: HEXMEM_KEY,
        },
    };
    if (JSON.stringify(config.plugins.entries.hexmem) !== JSON.stringify(correctConfig)) {
        config.plugins.entries.hexmem = correctConfig;
        changed = true;
    }

    // 4d: Update tools.allow
    const requiredTools = [
        "hexmem_recall", "hexmem_store", "hexmem_search",
        "hexmem_status", "hexmem_sql", "hexmem_session_log",
    ];
    config.tools = config.tools || {};
    config.tools.allow = config.tools.allow || [];
    const toolAllow = config.tools.allow as string[];

    // Remove old hexmem_health if present
    const healthIdx = toolAllow.indexOf("hexmem_health");
    if (healthIdx >= 0) {
        toolAllow.splice(healthIdx, 1);
        changed = true;
    }

    for (const tool of requiredTools) {
        if (!toolAllow.includes(tool)) {
            toolAllow.push(tool);
            changed = true;
        }
    }

    // 4e: Update compaction memoryFlush
    if (config.agents?.defaults?.compaction?.memoryFlush) {
        const mf = config.agents.defaults.compaction.memoryFlush;
        mf.prompt =
            "Session nearing compaction. Store all important context to HexMem using hexmem_store: " +
            "facts to 'fact', decisions to 'decision', events to 'event', tasks to 'task'. " +
            "Include full metadata (tags, context, rationale). Then use hexmem_session_log to " +
            "save a summary of this session. Reply 'HexMem flush complete' when done.";
        mf.systemPrompt =
            "IMPORTANT: Session nearing compaction. Store critical memories to HexMem before context is lost.";
        changed = true;
    }

    if (changed && !CHECK_ONLY) {
        // Backup
        const backup = OPENCLAW_JSON + ".backup." + Date.now();
        fs.copyFileSync(OPENCLAW_JSON, backup);
        log("  📁", `Backed up → ${path.basename(backup)}`);

        fs.writeFileSync(OPENCLAW_JSON, JSON.stringify(config, null, 2) + "\n");
        log("  ✓", "openclaw.json updated");
    } else if (CHECK_ONLY) {
        log("  ℹ", changed ? "Changes needed" : "Already up to date");
    } else {
        log("  ✓", "Already up to date");
    }
}

// ================================================================
// Step 5: Update agent MEMORY.md files
// ================================================================
function updateMemoryFiles(): void {
    log("📝", "Updating agent MEMORY.md files...");

    const agentsDir = process.env.OPENCLAW_AGENTS_DIR
        || path.join(process.env.HOME || "~", "openclaw/agents");

    // Derive MEMORY.md paths from the AGENTS list
    const memoryPaths = AGENTS.map(slug =>
        path.join(agentsDir, `${slug}/workspace/MEMORY.md`)
    );

    const hexmemSection = `### HexMem Memory System
**Location:** \`~/openclaw/projects/hexmem\`
**Purpose:** Structured semantic memory with embeddings, decay, deduplication
**API:** ${HEXMEM_URL}

**Tools available:**
- \`hexmem_recall\` — semantic + keyword recall across all memory types
- \`hexmem_store\` — store facts, decisions, events, tasks
- \`hexmem_search\` — vector search over specific tables
- \`hexmem_status\` — memory health & counts
- \`hexmem_session_log\` — log session messages for continuity
- \`hexmem_sql\` — raw SQL queries (SELECT only)

**Commands:**
\`\`\`bash
# Start HexMem
cd ~/openclaw/projects/hexmem && npm run dev

# CLI access
cd ~/openclaw/projects/hexmem && npx tsx src/cli.ts status --agent <your-agent-slug>
npx tsx src/cli.ts recall "query" --agent <your-agent-slug>
\`\`\``;

    for (const memPath of memoryPaths) {
        if (!fs.existsSync(memPath)) {
            log("  ⚠", `Not found: ${memPath}`);
            continue;
        }

        const content = fs.readFileSync(memPath, "utf-8");

        // Check if already updated
        if (content.includes("HexMem Memory System")) {
            log("  ✓", `${path.basename(path.dirname(path.dirname(memPath)))}: already updated`);
            continue;
        }

        if (CHECK_ONLY) {
            log("  ⚠", `${path.basename(path.dirname(path.dirname(memPath)))}: needs update`);
            continue;
        }

        // Replace old memory system section or append
        let updated: string;
        const oldSectionRegex = /### (HexKit|HexMem) Memory System[\s\S]*?(?=\n---|\n###|$)/;

        if (oldSectionRegex.test(content)) {
            updated = content.replace(oldSectionRegex, hexmemSection);
        } else {
            // Append after Infrastructure section header, or at end
            const infraIdx = content.indexOf("## Infrastructure");
            if (infraIdx >= 0) {
                const insertIdx = content.indexOf("\n", infraIdx) + 1;
                updated = content.slice(0, insertIdx) + "\n" + hexmemSection + "\n\n" + content.slice(insertIdx);
            } else {
                updated = content + "\n\n## Infrastructure\n\n" + hexmemSection + "\n";
            }
        }

        fs.writeFileSync(memPath, updated);
        const agentSlug = path.basename(path.dirname(path.dirname(memPath)));
        log("  ✓", `${agentSlug}: MEMORY.md updated`);
    }
}

// ================================================================
// Step 6: Validate
// ================================================================
async function validate(): Promise<void> {
    log("🧪", "Validating integration...");

    // Test recall
    try {
        // Need the first agent's UUID for recall test
        const agent = await hexmemFetch(`/api/v1/agents/${AGENTS[0]}`);
        const results = await hexmemFetch("/api/v1/recall", {
            method: "POST",
            body: JSON.stringify({ query: "test", agent_id: agent.id, limit: 1 }),
        });
        const count = Array.isArray(results) ? results.length : (results.results?.length || 0);
        log("  ✓", `Recall works (${count} result(s))`);
    } catch (err: any) {
        log("  ⚠", `Recall test failed: ${err.message}`);
    }

    // Check plugin installed
    const pluginIndex = path.join(EXTENSIONS_DIR, "hexmem", "index.ts");
    log(fs.existsSync(pluginIndex) ? "  ✓" : "  ⚠",
        fs.existsSync(pluginIndex) ? "Plugin files present" : "Plugin files missing");

    // Check openclaw.json
    if (fs.existsSync(OPENCLAW_JSON)) {
        const config = JSON.parse(fs.readFileSync(OPENCLAW_JSON, "utf-8"));
        const hasSlot = config.plugins?.slots?.memory === "hexmem";
        const hasEntry = config.plugins?.entries?.hexmem?.enabled === true;
        log(hasSlot ? "  ✓" : "  ⚠", hasSlot ? "Memory slot claimed" : "Memory slot not set");
        log(hasEntry ? "  ✓" : "  ⚠", hasEntry ? "Plugin entry configured" : "Plugin entry missing");
    }
}

// ================================================================
// Main
// ================================================================
async function main(): Promise<void> {
    console.log("╔══════════════════════════════════════════╗");
    console.log("║   HexMem ↔ OpenClaw Integration Setup   ║");
    console.log("╚══════════════════════════════════════════╝\n");

    if (CHECK_ONLY) console.log("🔍 CHECK MODE — no changes will be made\n");

    if (AGENTS.length === 0) {
        console.log("⚠  No agents specified. Use --agents to list your OpenClaw agents:\n");
        console.log("   npx tsx tools/setup-openclaw.ts --agents agent1,agent2,agent3\n");
        console.log("This will create a HexMem agent for each, install the plugin,");
        console.log("and update openclaw.json and agent MEMORY.md files.\n");
        process.exit(1);
    }

    // Step 1
    const alive = await verifyHexMem();
    if (!alive && !CHECK_ONLY) {
        process.exit(1);
    }

    // Step 2
    console.log("");
    await createAgents();

    // Step 3
    console.log("");
    installPlugin();

    // Step 4
    console.log("");
    updateOpenClawJson();

    // Step 5
    console.log("");
    updateMemoryFiles();

    // Step 6
    console.log("");
    await validate();

    console.log("\n" + "═".repeat(44));
    if (CHECK_ONLY) {
        console.log("✅ Check complete — review items above");
    } else {
        console.log("✅ Integration complete!");
        console.log("\nNext steps:");
        console.log("  1. Restart OpenClaw gateway: openclaw restart");
        console.log("  2. Verify: openclaw plugins list");
        console.log("  3. Test: ask an agent to 'recall hexmem migration'");
    }
    console.log("═".repeat(44));
}

main().catch((err) => {
    console.error("\n❌ Setup failed:", err.message);
    process.exit(1);
});
