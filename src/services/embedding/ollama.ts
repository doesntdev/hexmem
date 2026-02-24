import type { EmbeddingProvider } from '../../types/index.js';

/**
 * Ollama local embedding provider.
 * Connects to a locally running Ollama instance via HTTP API.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
    readonly name = 'ollama';
    readonly dimensions: number;
    private baseUrl: string;
    private model: string;

    constructor(baseUrl: string = 'http://localhost:11434', model: string = 'nomic-embed-text') {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.model = model;
        // Common Ollama embedding model dimensions
        // nomic-embed-text: 768, mxbai-embed-large: 1024, all-minilm: 384
        this.dimensions = 768; // default, actual will depend on model
    }

    async embed(text: string): Promise<number[]> {
        const response = await fetch(`${this.baseUrl}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                input: text,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Ollama embedding failed (${response.status}): ${body}`);
        }

        const data = await response.json() as { embeddings: number[][] };
        return data.embeddings[0];
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${this.baseUrl}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                input: texts,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Ollama batch embedding failed (${response.status}): ${body}`);
        }

        const data = await response.json() as { embeddings: number[][] };
        return data.embeddings;
    }
}
