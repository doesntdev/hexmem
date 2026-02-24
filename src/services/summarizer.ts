import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfig } from '../config.js';
import { query } from '../db/connection.js';

const SUMMARY_MODEL = 'gemini-2.0-flash';

const SUMMARY_PROMPT = `Summarize the following conversation session concisely. Focus on:
1. Key topics discussed
2. Decisions made
3. Action items identified
4. Important outcomes or conclusions

Write 2-4 sentences. Be specific and factual.`;

/**
 * Generate a summary for a session using its messages.
 */
export async function summarizeSession(sessionId: string): Promise<string | null> {
    const config = getConfig();
    if (!config.geminiApiKey) {
        console.warn('[summarizer] No GEMINI_API_KEY, skipping summarization');
        return null;
    }

    // Fetch session messages
    const { rows: messages } = await query<{ role: string; content: string }>(
        `SELECT role, content FROM session_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
        [sessionId]
    );

    if (messages.length === 0) return null;

    const client = new GoogleGenerativeAI(config.geminiApiKey);
    const model = client.getGenerativeModel({ model: SUMMARY_MODEL });

    const formatted = messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join('\n\n');

    try {
        const result = await model.generateContent([
            { text: SUMMARY_PROMPT },
            { text: `\n\nConversation:\n${formatted}` },
        ]);

        const summary = result.response.text().trim();

        // Store summary on the session
        await query(
            'UPDATE sessions SET summary = $1 WHERE id = $2',
            [summary, sessionId]
        );

        return summary;
    } catch (err) {
        console.error('[summarizer] Failed:', (err as Error).message);
        return null;
    }
}
