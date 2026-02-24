import { GoogleGenerativeAI } from '@google/generative-ai';
import { getConfig } from '../config.js';

const EXTRACTION_MODEL = 'gemini-2.0-flash';

interface ExtractedFact {
    content: string;
    subject: string | null;
    confidence: number;
    tags: string[];
}

interface ExtractedDecision {
    title: string;
    decision: string;
    rationale: string;
    alternatives: Array<{ option: string; reason_rejected: string }>;
    tags: string[];
}

interface ExtractedTask {
    title: string;
    description: string | null;
    priority: number;
    tags: string[];
}

interface ExtractedEvent {
    title: string;
    event_type: 'incident' | 'milestone' | 'release' | 'discovery' | 'blocker' | 'resolution';
    description: string | null;
    severity: 'info' | 'warning' | 'critical';
    tags: string[];
}

export interface ExtractionResult {
    facts: ExtractedFact[];
    decisions: ExtractedDecision[];
    tasks: ExtractedTask[];
    events: ExtractedEvent[];
}

const EXTRACTION_PROMPT = `You are a knowledge extraction system. Analyze the following conversation messages and extract structured information.

Extract ONLY items that are clearly stated or strongly implied. Do NOT fabricate or infer beyond what the text says.

Return a JSON object with these arrays (empty arrays if nothing found):

{
  "facts": [
    {
      "content": "clear factual statement",
      "subject": "topic or entity this fact is about (or null)",
      "confidence": 0.0-1.0,
      "tags": ["relevant", "tags"]
    }
  ],
  "decisions": [
    {
      "title": "short title for this decision",
      "decision": "what was decided",
      "rationale": "why this was decided",
      "alternatives": [{"option": "rejected option", "reason_rejected": "why"}],
      "tags": ["relevant", "tags"]
    }
  ],
  "tasks": [
    {
      "title": "task title",
      "description": "details or null",
      "priority": 50,
      "tags": ["relevant", "tags"]
    }
  ],
  "events": [
    {
      "title": "event title",
      "event_type": "one of: incident|milestone|release|discovery|blocker|resolution",
      "description": "details or null",
      "severity": "one of: info|warning|critical",
      "tags": ["relevant", "tags"]
    }
  ]
}

Guidelines:
- Facts: Concrete statements about the world, preferences, configurations, code decisions
- Decisions: Explicit choices made between alternatives
- Tasks: Action items, TODOs, things to implement/fix
- Events: Notable occurrences, incidents, milestones, blockers
- Priority: 1-100 where 100 is most urgent
- Confidence: How certain you are this fact is true based on context
- Be conservative: only extract items with clear textual support
- Respond ONLY with the JSON object, no markdown fences or extra text`;

/**
 * Extract structured items from conversation messages using Gemini Flash.
 */
export async function extractStructuredItems(
    messages: Array<{ role: string; content: string }>
): Promise<ExtractionResult> {
    const config = getConfig();
    if (!config.geminiApiKey) {
        console.warn('[extraction] No GEMINI_API_KEY, skipping extraction');
        return { facts: [], decisions: [], tasks: [], events: [] };
    }

    const client = new GoogleGenerativeAI(config.geminiApiKey);
    const model = client.getGenerativeModel({ model: EXTRACTION_MODEL });

    // Format messages for context
    const formatted = messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join('\n\n');

    try {
        const result = await model.generateContent([
            { text: EXTRACTION_PROMPT },
            { text: `\n\nConversation:\n${formatted}` },
        ]);

        const text = result.response.text().trim();

        // Try to parse JSON (handle markdown code fences if present)
        const cleaned = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        const parsed = JSON.parse(cleaned) as ExtractionResult;

        // Validate structure
        return {
            facts: Array.isArray(parsed.facts) ? parsed.facts : [],
            decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
            tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
            events: Array.isArray(parsed.events) ? parsed.events : [],
        };
    } catch (err) {
        console.error('[extraction] Failed to extract structured items:', (err as Error).message);
        return { facts: [], decisions: [], tasks: [], events: [] };
    }
}

/**
 * Extract from a single message (used for inline extraction on message ingest).
 * Includes the last few messages for context.
 */
export async function extractFromMessage(
    currentMessage: { role: string; content: string },
    recentContext: Array<{ role: string; content: string }> = []
): Promise<ExtractionResult> {
    // Include recent context + current message for better extraction
    const allMessages = [...recentContext.slice(-4), currentMessage];
    return extractStructuredItems(allMessages);
}
