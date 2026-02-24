import 'dotenv/config';

export interface Config {
    port: number;
    databaseUrl: string;
    nodeEnv: string;
    devKey: string | null;

    // Embedding
    embeddingProvider: 'gemini' | 'openai' | 'ollama';
    geminiApiKey: string | null;
    openaiApiKey: string | null;
    ollamaUrl: string;
    ollamaModel: string;
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export function loadConfig(): Config {
    const embeddingProvider = (process.env.EMBEDDING_PROVIDER || 'gemini') as Config['embeddingProvider'];

    return {
        port: parseInt(process.env.PORT || '3400', 10),
        databaseUrl: requiredEnv('DATABASE_URL'),
        nodeEnv: process.env.NODE_ENV || 'development',
        devKey: process.env.HEXMEM_DEV_KEY || null,

        embeddingProvider,
        geminiApiKey: process.env.GEMINI_API_KEY || null,
        openaiApiKey: process.env.OPENAI_API_KEY || null,
        ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
        ollamaModel: process.env.OLLAMA_MODEL || 'nomic-embed-text',
    };
}

// Singleton config — loaded once on import
let _config: Config | null = null;

export function getConfig(): Config {
    if (!_config) {
        _config = loadConfig();
    }
    return _config;
}
