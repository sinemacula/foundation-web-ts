/**
 * Unit tests for announced-session-persistence.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import { KeyValueSessionPersistence } from '@sinemacula/foundation/session/key-value-session-persistence';
import { MemoryStorage } from '@sinemacula/foundation/storage/memory-storage';
import { announceWrites } from './announced-session-persistence';
import { LINEAGE, snapshot, tokens } from './test-support/session-fixtures';

const SESSION = { lineage: LINEAGE, tokens: tokens() };

/** A channel recording each post. */
interface RecordingChannel extends BroadcastChannel {
    /** Records each post. */
    readonly postMessage: Mock<BroadcastChannel['postMessage']>;
}

/**
 * Build a channel recording each post.
 */
function recordingChannel(): RecordingChannel {
    return { postMessage: vi.fn() } as unknown as RecordingChannel;
}

describe('announceWrites', () => {
    it('announces a committed save and clear with an empty message', async () => {
        const channel = recordingChannel();
        const persistence = announceWrites(new KeyValueSessionPersistence(new MemoryStorage()), channel);

        await expect(persistence.saveIf({ revision: 0, lineage: null }, SESSION)).resolves.toStrictEqual({
            status: 'saved',
            revision: 1,
        });
        await expect(persistence.clearIf({ revision: 1, lineage: LINEAGE })).resolves.toStrictEqual({
            status: 'cleared',
            revision: 2,
        });
        await expect(persistence.load()).resolves.toStrictEqual(snapshot(null, 2));
        expect(channel.postMessage.mock.calls).toStrictEqual([[null], [null]]);
    });

    it('announces no refused write', async () => {
        const channel = recordingChannel();
        const persistence = announceWrites(new KeyValueSessionPersistence(new MemoryStorage()), channel);

        await expect(persistence.saveIf({ revision: 3, lineage: null }, SESSION)).resolves.toHaveProperty(
            'status',
            'changed',
        );
        await expect(persistence.clearIf({ revision: 3, lineage: null })).resolves.toHaveProperty('status', 'changed');
        expect(channel.postMessage).not.toHaveBeenCalled();
    });

    it('keeps a committed write whose announcement fails', async () => {
        const channel = recordingChannel();
        const persistence = announceWrites(new KeyValueSessionPersistence(new MemoryStorage()), channel);

        channel.postMessage.mockImplementation(() => {
            throw new DOMException('The channel is closed.', 'InvalidStateError');
        });

        await expect(persistence.saveIf({ revision: 0, lineage: null }, SESSION)).resolves.toHaveProperty(
            'status',
            'saved',
        );
    });
});
