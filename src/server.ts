import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getConfig } from './config.js';
import { checkConnection, closePool } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { authMiddleware } from './services/auth.js';
import { createEmbeddingProvider } from './services/embedding/index.js';
import { agentRoutes } from './routes/agents.js';
import { keyRoutes } from './routes/keys.js';
import { sessionRoutes } from './routes/sessions.js';
import { searchRoutes } from './routes/search.js';
import { memoryRoutes } from './routes/memory.js';
import { edgeRoutes } from './routes/edges.js';
import { recallRoutes } from './routes/recall.js';
import { runDecaySweep } from './services/decay.js';
import { queryLogPlugin, analyticsRoutes } from './services/querylog.js';
import { startBackgroundJobs, stopBackgroundJobs } from './services/jobs.js';
import type { EmbeddingProvider } from './types/index.js';

// Global embedding provider instance
let embeddingProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider | null {
    return embeddingProvider;
}

async function main(): Promise<void> {
    const config = getConfig();

    const app = Fastify({
        logger: {
            level: config.nodeEnv === 'production' ? 'info' : 'debug',
            transport: config.nodeEnv !== 'production'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
        },
    });

    // CORS
    await app.register(cors, {
        origin: true,
        credentials: true,
    });

    // Health check (unauthenticated)
    app.get('/health', async (_request, reply) => {
        const dbConnected = await checkConnection();
        const status = dbConnected ? 'ok' : 'degraded';
        const code = dbConnected ? 200 : 503;

        return reply.code(code).send({
            status,
            db: dbConnected ? 'connected' : 'disconnected',
            embedding: embeddingProvider ? embeddingProvider.name : 'not configured',
            timestamp: new Date().toISOString(),
        });
    });

    // Auth middleware for all /api/* routes
    app.addHook('onRequest', async (request, reply) => {
        // Skip auth for health check and non-API routes
        if (!request.url.startsWith('/api/')) return;
        await authMiddleware(request, reply);
    });

    // Query logging plugin
    await app.register(queryLogPlugin);

    // Register routes
    await agentRoutes(app);
    await keyRoutes(app);
    await sessionRoutes(app);
    await searchRoutes(app);
    await memoryRoutes(app);
    await edgeRoutes(app);
    await recallRoutes(app);
    await analyticsRoutes(app);

    // Decay sweep endpoint (manual trigger)
    app.post('/api/v1/decay/sweep', async (request, reply) => {
        const { agent_id } = request.body as { agent_id?: string };
        const stats = await runDecaySweep(agent_id);
        return reply.send(stats);
    });

    // Initialize embedding provider
    try {
        embeddingProvider = createEmbeddingProvider({
            provider: config.embeddingProvider,
            geminiApiKey: config.geminiApiKey ?? undefined,
            openaiApiKey: config.openaiApiKey ?? undefined,
            ollamaUrl: config.ollamaUrl,
            ollamaModel: config.ollamaModel,
        });
        app.log.info(`Embedding provider: ${embeddingProvider.name} (${embeddingProvider.dimensions} dimensions)`);
    } catch (err) {
        app.log.warn(`Embedding provider not available: ${(err as Error).message}. Embedding features disabled.`);
    }

    // Run migrations
    app.log.info('Running database migrations...');
    await runMigrations();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
        app.log.info(`Received ${signal}, shutting down...`);
        stopBackgroundJobs();
        await app.close();
        await closePool();
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Start server
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`HexMem API server listening on http://0.0.0.0:${config.port}`);

    // Start background jobs
    startBackgroundJobs();
}

main().catch((err) => {
    console.error('Failed to start HexMem server:', err);
    process.exit(1);
});
