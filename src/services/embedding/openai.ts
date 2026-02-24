import OpenAI from 'openai';
import type { EmbeddingProvider } from '../../types/index.js';

const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const BATCH_SIZE = 2048; // OpenAI supports large batches

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    readonly name = 'openai';
    readonly dimensions = DIMENSIONS;
    private client: OpenAI;

    constructor(apiKey: string) {
        this.client = new OpenAI({ apiKey });
    }

    async embed(text: string): Promise<number[]> {
        const response = await this.client.embeddings.create({
            model: MODEL,
            input: text,
        });
        return response.data[0].embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];

        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
            const batch = texts.slice(i, i + BATCH_SIZE);
            const response = await this.client.embeddings.create({
                model: MODEL,
                input: batch,
            });
            // Sort by index to maintain order
            const sorted = response.data.sort((a, b) => a.index - b.index);
            results.push(...sorted.map((d) => d.embedding));
        }

        return results;
    }
}
