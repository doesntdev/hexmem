/**
 * Shared test helpers for HexMem integration tests.
 * Tests hit the live API server at http://localhost:3400.
 */

const BASE_URL = process.env.HEXMEM_TEST_URL || 'http://localhost:3400';
const AUTH_HEADER = `Bearer ${process.env.HEXMEM_TEST_KEY || 'hexmem_dev_key'}`;

export interface RequestOptions {
    method?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string>;
}

export async function api<T = Record<string, unknown>>(
    path: string,
    options: RequestOptions = {}
): Promise<{ status: number; data: T }> {
    const { method = 'GET', body, query } = options;

    let url = `${BASE_URL}${path}`;
    if (query) {
        const params = new URLSearchParams(query);
        url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {
        Authorization: AUTH_HEADER,
    };
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    // For 204 No Content
    if (res.status === 204) {
        return { status: 204, data: {} as T };
    }

    const data = await res.json() as T;
    return { status: res.status, data };
}

/**
 * Helper to create a test agent with a unique slug.
 * Returns the agent_id.
 */
export async function createTestAgent(slug?: string): Promise<string> {
    const testSlug = slug || `test-agent-${Date.now()}`;
    const { status, data } = await api<{ id: string }>('/api/v1/agents', {
        method: 'POST',
        body: {
            slug: testSlug,
            display_name: `Test Agent ${testSlug}`,
            description: 'Automated test agent',
        },
    });
    if (status !== 201) {
        throw new Error(`Failed to create test agent: ${JSON.stringify(data)}`);
    }
    return data.id;
}
