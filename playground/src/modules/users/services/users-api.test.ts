/**
 * Unit tests for mapUserRow and createUsersClient.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { describe, expect, it } from 'vitest';

import { createUsersClient, mapUserRow } from '@/modules/users/services/users-api';
import { FakeHttpClient } from '@/test-support/fake-http-client';

/**
 * Build a record from pairs so snake_case wire keys avoid object-literal keys.
 */
function wire(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
    return Object.fromEntries(entries);
}

/** A valid raw user row as returned by the API. */
function validRow(): Record<string, unknown> {
    return wire([
        ['id', 'u1'],
        ['full_name', 'Alice Smith'],
        ['email', 'alice@example.com'],
        ['created_at', '2026-01-01 00:00:00'],
    ]);
}

describe('mapUserRow', () => {
    it('maps a valid raw record onto a UserListItem', () => {
        expect(mapUserRow(validRow())).toEqual({
            id: 'u1',
            fullName: 'Alice Smith',
            email: 'alice@example.com',
            createdAt: '2026-01-01 00:00:00',
        });
    });

    it.each(['id', 'full_name', 'email', 'created_at'])('throws when %s is not a string', field => {
        expect(() => mapUserRow({ ...validRow(), [field]: 42 })).toThrow(
            'The user row did not match the expected shape.',
        );
    });
});

describe('createUsersClient', () => {
    it('sends GET requests to the users path and maps the response', async () => {
        const fake = new FakeHttpClient();

        fake.queueResponse({ data: [validRow()] });

        const client = createUsersClient(fake);
        const result = await client.list();

        const call = fake.calls.at(0);

        expect(call?.method).toBe('GET');
        expect(call?.path).toBe('users');
        expect(result.items).toEqual([
            { id: 'u1', fullName: 'Alice Smith', email: 'alice@example.com', createdAt: '2026-01-01 00:00:00' },
        ]);
    });
});
