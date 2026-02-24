import type { EmbeddingProvider, EmbeddingConfig } from '../../types/index.js';
import { GeminiEmbeddingProvider } from './gemini.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { OllamaEmbeddingProvider } from './ollama.js';

export type { EmbeddingProvider } from '../../types/index.js';

/**
 * Create an embedding provider based on config.
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
    switch (config.provider) {
        case 'gemini':
            if (!config.geminiApiKey) {
                throw new Error('GEMINI_API_KEY is required for Gemini embedding provider');
            }
            return new GeminiEmbeddingProvider(config.geminiApiKey);

        case 'openai':
            if (!config.openaiApiKey) {
                throw new Error('OPENAI_API_KEY is required for OpenAI embedding provider');
            }
            return new OpenAIEmbeddingProvider(config.openaiApiKey);

        case 'ollama':
            return new OllamaEmbeddingProvider(
                config.ollamaUrl || 'http://localhost:11434',
                config.ollamaModel || 'nomic-embed-text'
            );

        default:
            throw new Error(`Unknown embedding provider: ${config.provider}`);
    }
}
