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

/**
 * Parse the API's `YYYY-MM-DD HH:MM:SS` UTC wire timestamp, or return null when
 * it is not in that exact form or names a date or time that does not exist.
 */
function parseWireTimestamp(wireTimestamp: string): Date | null {
    const parsed = new Date(`${wireTimestamp.replace(' ', 'T')}Z`);

    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    // Formatting back rejects other shapes and values Date rolls over, such as February 30.
    return parsed.toISOString().slice(0, 19).replace('T', ' ') === wireTimestamp ? parsed : null;
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
