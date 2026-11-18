/**
 * Component tests for confirm-host.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { ConfirmService } from '@sinemacula/foundation-web/notifications/confirm-service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';

import ConfirmHost from '@/components/confirm-host.vue';
import { initialiseConfirm, resetConfirm } from '@/services/confirm';

/** The content of a confirmation request. */
const REQUEST = { title: 'confirm.title', message: 'confirm.message' };

/** The mounted host and the controls a test drives it through. */
interface MountedHost {
    /** Unmount the host and detach its container. */
    readonly unmount: () => void;
}

let service: ConfirmService;
let opener: HTMLButtonElement;

/**
 * Mount ConfirmHost into the document with an empty message catalogue.
 */
function mountHost(): MountedHost {
    const container = document.createElement('div');

    document.body.appendChild(container);

    const app = createApp(ConfirmHost);

    app.use(createI18n({ legacy: false, locale: 'en-US', messages: {} }));
    app.mount(container);

    return {
        unmount: () => {
            app.unmount();
            container.remove();
        },
    };
}

/**
 * Let the dialog render and the trap engage.
 */
async function settle(): Promise<void> {
    await nextTick();
    await nextTick();
}

/**
 * The open dialog's action buttons, cancel first.
 */
function actions(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'));
}

/**
 * The label of the element that currently holds focus.
 */
function focusedLabel(): string | undefined {
    return document.activeElement?.textContent?.trim();
}

/**
 * Dispatch a keydown from the focused element, as the browser would.
 */
function press(key: string, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });

    document.activeElement?.dispatchEvent(event);

    return event;
}

describe('ConfirmHost', () => {
    beforeEach(() => {
        service = new ConfirmService();
        initialiseConfirm(service);
        opener = document.createElement('button');
        opener.textContent = 'opener';
        document.body.appendChild(opener);
        opener.focus();
    });

    afterEach(() => {
        opener.remove();
        resetConfirm();
    });

    it('renders nothing while no confirmation is active', () => {
        const host = mountHost();

        expect(document.querySelector('[role="alertdialog"]')).toBeNull();

        host.unmount();
    });

    it('moves focus to the first action when a confirmation opens', async () => {
        const host = mountHost();

        void service.confirm(REQUEST);
        await settle();

        expect(focusedLabel()).toBe('common.actions.cancel');

        host.unmount();
    });

    it('labels the dialog with its title and message', async () => {
        const host = mountHost();

        void service.confirm(REQUEST);
        await settle();

        const dialog = document.querySelector('[role="alertdialog"]');
        const title = document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '');
        const message = document.getElementById(dialog?.getAttribute('aria-describedby') ?? '');

        expect(dialog?.getAttribute('aria-modal')).toBe('true');
        expect(title?.textContent?.trim()).toBe('confirm.title');
        expect(message?.textContent?.trim()).toBe('confirm.message');

        host.unmount();
    });

    it('renders custom action labels', async () => {
        const host = mountHost();

        void service.confirm({ ...REQUEST, confirmLabel: 'confirm.yes', cancelLabel: 'confirm.no' });
        await settle();

        expect(actions().map(button => button.textContent?.trim())).toEqual(['confirm.no', 'confirm.yes']);

        host.unmount();
    });

    it('wraps Tab from the last action to the first', async () => {
        const host = mountHost();

        void service.confirm(REQUEST);
        await settle();

        actions()[1]?.focus();
        const event = press('Tab');

        expect(event.defaultPrevented).toBe(true);
        expect(focusedLabel()).toBe('common.actions.cancel');

        host.unmount();
    });

    it('wraps Shift+Tab from the first action to the last', async () => {
        const host = mountHost();

        void service.confirm(REQUEST);
        await settle();

        const event = press('Tab', true);

        expect(event.defaultPrevented).toBe(true);
        expect(focusedLabel()).toBe('common.actions.confirm');

        host.unmount();
    });

    it.each([
        ['the confirm action', true],
        ['the cancel action', false],
    ])('resolves with the outcome of %s and returns focus to the opener', async (_action, outcome) => {
        const host = mountHost();
        const answer = service.confirm(REQUEST);

        await settle();
        actions()[outcome ? 1 : 0]?.click();
        await settle();

        await expect(answer).resolves.toBe(outcome);
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
        expect(document.activeElement).toBe(opener);

        host.unmount();
    });

    it('cancels on Escape and returns focus to the opener', async () => {
        const host = mountHost();
        const answer = service.confirm(REQUEST);

        await settle();
        press('Escape');
        await settle();

        await expect(answer).resolves.toBe(false);
        expect(document.activeElement).toBe(opener);

        host.unmount();
    });

    it('re-engages on a queued confirmation and returns focus to the opener after the last', async () => {
        const host = mountHost();
        const first = service.confirm(REQUEST);
        const second = service.confirm({ ...REQUEST, confirmLabel: 'confirm.again' });

        await settle();
        actions()[1]?.click();
        await settle();

        await expect(first).resolves.toBe(true);
        expect(focusedLabel()).toBe('common.actions.cancel');

        actions()[1]?.focus();
        press('Tab');

        expect(focusedLabel()).toBe('common.actions.cancel');

        press('Escape');
        await settle();

        await expect(second).resolves.toBe(false);
        expect(document.activeElement).toBe(opener);

        host.unmount();
    });

    it('ignores a click on an answered dialog once the next request surfaces', async () => {
        const host = mountHost();
        const first = service.confirm(REQUEST);
        const second = service.confirm({ ...REQUEST, confirmLabel: 'confirm.again' });

        await settle();

        const staleConfirm = actions()[1];

        staleConfirm?.click();
        staleConfirm?.click();
        await settle();
        staleConfirm?.click();

        await expect(first).resolves.toBe(true);
        expect(service.active.value?.confirmLabel).toBe('confirm.again');
        expect(actions().map(button => button.disabled)).toEqual([false, false]);

        service.settle(false);
        await expect(second).resolves.toBe(false);

        host.unmount();
    });

    it('engages on a confirmation already active when it mounts', async () => {
        void service.confirm(REQUEST);

        const host = mountHost();

        await settle();

        expect(focusedLabel()).toBe('common.actions.cancel');

        host.unmount();
    });

    it('returns focus to the opener when unmounted while open', async () => {
        const host = mountHost();

        void service.confirm(REQUEST);
        await settle();

        host.unmount();

        expect(document.activeElement).toBe(opener);
    });
});
