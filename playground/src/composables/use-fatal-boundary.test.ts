/**
 * Unit tests for useFatalBoundary.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { ErrorReporter } from '@sinemacula/foundation/reporting/error-reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';

import type { FatalBoundary } from '@/composables/use-fatal-boundary';
import { useFatalBoundary } from '@/composables/use-fatal-boundary';
import { initialiseReporting, resetReporting } from '@/services/reporting';

/**
 * Minimal spyable {@link ErrorReporter} stub.
 */
function fakeReporter(): ErrorReporter {
    return { captureError: vi.fn(), captureMessage: vi.fn(), setUser: vi.fn() };
}

/**
 * Component that throws from `setup()` when `shouldThrow` is set.
 */
const Thrower = defineComponent({
    props: { shouldThrow: { type: Boolean, required: true } },
    setup(props) {
        if (props.shouldThrow) {
            throw new Error('exploded rendering the descendant');
        }

        return () => null;
    },
});

interface MountedBoundary {
    /** The boundary state installed by the host component. */
    readonly boundary: FatalBoundary;

    /** Toggle whether the throwing child is rendered. */
    readonly showThrower: (value: boolean) => void;

    /** Unmount the host component. */
    readonly unmount: () => void;
}

/**
 * Mount a host installing {@link useFatalBoundary} around a toggleable child.
 */
function mountBoundary(): MountedBoundary {
    let boundary!: FatalBoundary;
    const shouldThrow = ref(false);

    const Host = defineComponent({
        setup() {
            boundary = useFatalBoundary();

            return () => (shouldThrow.value ? h(Thrower, { shouldThrow: true }) : h('div'));
        },
    });

    const container = document.createElement('div');
    const app = createApp(Host);

    app.mount(container);

    return {
        boundary,
        showThrower: (value: boolean) => {
            shouldThrow.value = value;
        },
        unmount: () => app.unmount(),
    };
}

describe('useFatalBoundary', () => {
    let reporter: ErrorReporter;

    beforeEach(() => {
        reporter = fakeReporter();
        initialiseReporting(reporter);
    });

    afterEach(() => {
        resetReporting();
    });

    it('starts with fatal false', () => {
        const { boundary, unmount } = mountBoundary();

        expect(boundary.fatal.value).toBe(false);

        unmount();
    });

    it('sets fatal true and reports the error when a descendant throws', async () => {
        const { boundary, showThrower, unmount } = mountBoundary();

        showThrower(true);
        await nextTick();

        expect(boundary.fatal.value).toBe(true);
        expect(reporter.captureError).toHaveBeenCalledWith(expect.any(Error), {
            source: 'fatal-boundary',
            info: expect.any(String),
        });

        unmount();
    });

    it('reset() clears the fatal state', async () => {
        const { boundary, showThrower, unmount } = mountBoundary();

        showThrower(true);
        await nextTick();
        expect(boundary.fatal.value).toBe(true);

        boundary.reset();

        expect(boundary.fatal.value).toBe(false);

        unmount();
    });
});
