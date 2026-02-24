/**
 * @hexmem/sdk — TypeScript client for the HexMem memory API.
 *
 * Usage:
 *   import { HexMem } from '@hexmem/sdk';
 *   const mem = new HexMem({ baseUrl: 'http://localhost:3400', apiKey: 'hexmem_dev_key' });
 *   const session = await mem.startSession({ agentId: 'openclaw' });
 */

export { HexMem, HexMemError } from './client.js';
export { memoryStoreToolDef, memoryRecallToolDef, getOpenClawTools } from './openclaw-tools.js';
export type {
    HexMemConfig,
    Agent,
    Session,
    Message,
    Fact,
    Decision,
    Task,
    Event,
    Project,
    Edge,
    RecallResult,
    RecallOptions,
    SearchResult,
    DecayStatus,
    ListOptions,
} from './types.js';
