import type { EmbeddingProvider } from '../../types/index.js';

const MODEL = 'gemini-embedding-001';
const DIMENSIONS = 768;
const BATCH_SIZE = 100;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini embedding provider using direct REST API (v1 endpoint).
 * The SDK uses v1beta which has inconsistent model availability,
 * so we use the v1 REST endpoint directly.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
    readonly name = 'gemini';
    readonly dimensions = DIMENSIONS;
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async embed(text: string): Promise<number[]> {
        const url = `${BASE_URL}/models/${MODEL}:embedContent?key=${this.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: `models/${MODEL}`,
                content: { parts: [{ text }] },
                outputDimensionality: DIMENSIONS,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Gemini embedding failed (${response.status}): ${body}`);
        }

        const data = await response.json() as { embedding: { values: number[] } };
        return data.embedding.values;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];

        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            const url = `${BASE_URL}/models/${MODEL}:batchEmbedContents?key=${this.apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requests: batch.map((text) => ({
                        model: `models/${MODEL}`,
                        content: { parts: [{ text }] },
                        outputDimensionality: DIMENSIONS,
                    })),
                }),
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(`Gemini batch embedding failed (${response.status}): ${body}`);
            }

            const data = await response.json() as { embeddings: Array<{ values: number[] }> };
            results.push(...data.embeddings.map((e) => e.values));
        }

        return results;
    }
}
