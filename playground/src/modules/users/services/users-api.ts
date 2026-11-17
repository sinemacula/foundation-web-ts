/**
 * Users API gateway: the row shape and validator for the `users` endpoint.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { HttpClient } from '@sinemacula/foundation/http/http-client';
import type { RawRecord, ResourceMapper } from '@sinemacula/foundation/query/envelope';
import { ResourceClient } from '@sinemacula/foundation/query/resource-client';

import { PlaygroundError } from '@/errors/playground-error';

/**
 * A row in the users list.
 */
export interface UserListItem {
    /** The user's unique identifier. */
    readonly id: string;

    /** The user's full name. */
    readonly fullName: string;

    /** The user's email address. */
    readonly email: string;

    /** When the user was created. */
    readonly createdAt: Date;
}

/** The API's `YYYY-MM-DD HH:MM:SS` UTC wire timestamp. */
const WIRE_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Parse a wire timestamp as a UTC instant, or null when it is malformed or
 * names a calendar date or time that does not exist.
 */
function parseWireTimestamp(wireTimestamp: string): Date | null {
    if (!WIRE_TIMESTAMP.test(wireTimestamp)) {
        return null;
    }

    const iso = `${wireTimestamp.replace(' ', 'T')}.000Z`;
    const parsed = new Date(iso);

    // Rejects values Date silently rolls over, such as February 30 or 24:00:00.
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === iso ? parsed : null;
}

/**
 * Validate and map a raw wire record onto a {@link UserListItem}.
 *
 * @throws PlaygroundError when a required field is missing, of the wrong type
 * or, for `created_at`, not a valid wire timestamp
 */
export const mapUserRow: ResourceMapper<UserListItem> = (raw: RawRecord): UserListItem => {
    const createdAt = typeof raw['created_at'] === 'string' ? parseWireTimestamp(raw['created_at']) : null;

    if (
        typeof raw['id'] !== 'string' ||
        typeof raw['full_name'] !== 'string' ||
        typeof raw['email'] !== 'string' ||
        createdAt === null
    ) {
        throw new PlaygroundError('The user row did not match the expected shape.');
    }

    return {
        id: raw['id'],
        fullName: raw['full_name'],
        email: raw['email'],
        createdAt,
    };
};

/**
 * Build a {@link ResourceClient} scoped to the `users` endpoint.
 */
export function createUsersClient(client: HttpClient): ResourceClient<UserListItem> {
    return new ResourceClient({ client, path: 'users', map: mapUserRow });
}
