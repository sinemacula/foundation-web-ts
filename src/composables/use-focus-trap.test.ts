/**
 * Unit tests for use-focus-trap.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useFocusTrap } from './use-focus-trap';

/**
 * Mount a container with the given inner HTML so `isConnected` holds.
 */
function buildContainer(innerHtml: string): HTMLElement {
    const div = document.createElement('div');

    div.innerHTML = innerHtml;
    document.body.appendChild(div);

    return div;
}

/**
 * Dispatch a cancelable keydown event on the active element.
 *
 * @returns the dispatched event
 */
function pressKey(key: string, shiftKey = false): KeyboardEvent {
    const target = document.activeElement ?? document.body;
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });

    target.dispatchEvent(event);

    return event;
}

describe('useFocusTrap', () => {
    let container: HTMLElement;

    afterEach(() => {
        container?.remove();
    });

    describe('container with nothing tabbable', () => {
        it('focuses the container through a temporary tabindex and keeps Tab inside', () => {
            const trigger = buildContainer('<button id="trigger">Trigger</button>');

            (trigger.firstElementChild as HTMLElement).focus();
            container = buildContainer('<p>Nothing to focus</p>');

            const trap = useFocusTrap(ref<HTMLElement | null>(container));

            trap.activate();

            expect(document.activeElement).toBe(container);
            expect(container.getAttribute('tabindex')).toBe('-1');

            const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });

            container.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(true);

            trap.deactivate();

            expect(container.hasAttribute('tabindex')).toBe(false);
            expect(document.activeElement?.id).toBe('trigger');

            trigger.remove();
        });

        it('keeps a tabindex the container already had', () => {
            container = buildContainer('');
            container.setAttribute('tabindex', '0');

            const trap = useFocusTrap(ref<HTMLElement | null>(container));

            trap.activate();
            trap.deactivate();

            expect(container.getAttribute('tabindex')).toBe('0');
        });
    });

    describe('null container ref', () => {
        it('activate is a safe no-op when the container ref is null', () => {
            const el = ref<HTMLElement | null>(null);
            const trap = useFocusTrap(el);

            expect(() => trap.activate()).not.toThrow();
        });

        it('deactivate is a safe no-op when the container ref is null', () => {
            const el = ref<HTMLElement | null>(null);
            const trap = useFocusTrap(el);

            expect(() => trap.deactivate()).not.toThrow();
        });
    });

    describe('single focusable element', () => {
        beforeEach(() => {
            container = buildContainer('<button id="only">Only</button>');
        });

        it('focuses the first (only) element on activate', () => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();

            expect(document.activeElement?.id).toBe('only');
        });

        it('Tab on the only element wraps back to itself', () => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('only');
        });

        it('Shift+Tab on the only element wraps back to itself', () => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            pressKey('Tab', true);

            expect(document.activeElement?.id).toBe('only');
        });
    });

    describe('multiple focusable elements', () => {
        beforeEach(() => {
            container = buildContainer(`
                <button id="first">First</button>
                <button id="middle">Middle</button>
                <button id="last">Last</button>
            `);
        });

        it('focuses the first element on activate', () => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();

            expect(document.activeElement?.id).toBe('first');
            expect(container.hasAttribute('tabindex')).toBe(false);
        });

        it('Tab on the last element wraps to the first', () => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();

            (container.querySelector<HTMLElement>('#last') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('first');
        });

        it('Shift+Tab on the first element wraps to the last', () => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            pressKey('Tab', true);

            expect(document.activeElement?.id).toBe('last');
        });

        it('Tab on a middle element does not interfere', () => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();

            (container.querySelector<HTMLElement>('#middle') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('middle');
        });

        it('Shift+Tab on a middle element does not interfere', () => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();

            (container.querySelector<HTMLElement>('#middle') as HTMLElement).focus();
            pressKey('Tab', true);

            expect(document.activeElement?.id).toBe('middle');
        });
    });

    describe('non-Tab keys', () => {
        beforeEach(() => {
            container = buildContainer('<button id="first">First</button><button id="last">Last</button>');
        });

        it.each(['Enter', 'Escape', 'ArrowDown'])('leaves %s on the last element alone', key => {
            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            (container.querySelector<HTMLElement>('#last') as HTMLElement).focus();

            const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

            document.activeElement?.dispatchEvent(event);

            expect(document.activeElement?.id).toBe('last');
            expect(event.defaultPrevented).toBe(false);

            trap.deactivate();
        });
    });

    describe('focused control removed after activation', () => {
        it('holds Tab when nothing tabbable is left', () => {
            container = buildContainer('<button id="dyn">Dynamic</button>');

            const trap = useFocusTrap(ref<HTMLElement | null>(container));

            trap.activate();
            (container.querySelector<HTMLElement>('#dyn') as HTMLElement).remove();

            expect(pressKey('Tab').defaultPrevented).toBe(true);

            trap.deactivate();
        });

        it('pulls focus back in from the body', () => {
            container = buildContainer('<button id="gone">Gone</button><button id="kept">Kept</button>');

            const trap = useFocusTrap(ref<HTMLElement | null>(container));

            trap.activate();
            (container.querySelector<HTMLElement>('#gone') as HTMLElement).remove();

            expect(document.activeElement).toBe(document.body);

            const event = pressKey('Tab');

            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement?.id).toBe('kept');

            trap.deactivate();
        });
    });

    describe('deactivate when no element was focused before activate', () => {
        it('deactivate is a safe no-op when nothing was focused at activation', () => {
            const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValueOnce(null);

            container = buildContainer('<button id="sole">Sole</button>');

            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            spy.mockRestore();

            expect(() => trap.deactivate()).not.toThrow();
        });
    });

    describe('deactivate', () => {
        it('restores focus to the element that was active before activate', () => {
            const trigger = document.createElement('button');

            trigger.id = 'trigger';
            document.body.appendChild(trigger);
            trigger.focus();

            container = buildContainer('<button id="inside">Inside</button>');

            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            expect(document.activeElement?.id).toBe('inside');

            trap.deactivate();
            expect(document.activeElement?.id).toBe('trigger');

            trigger.remove();
        });

        it('does not restore focus when the previous element has been removed from the DOM', () => {
            const trigger = document.createElement('button');

            trigger.id = 'detached';
            document.body.appendChild(trigger);
            trigger.focus();

            container = buildContainer('<button id="inside">Inside</button>');

            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();

            trigger.remove();

            expect(() => trap.deactivate()).not.toThrow();
        });

        it('removes the keydown listener so Tab no longer wraps after deactivate', () => {
            container = buildContainer('<button id="a">A</button><button id="b">B</button>');

            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            trap.deactivate();

            (container.querySelector<HTMLElement>('#b') as HTMLElement).focus();

            const activeBeforeTab = document.activeElement?.id;

            pressKey('Tab');

            expect(document.activeElement?.id).toBe(activeBeforeTab);
        });
    });

    describe('controls that Tab cannot reach', () => {
        beforeEach(() => {
            container = buildContainer(`
                <input type="hidden" name="leading" />
                <button id="first">First</button>
                <button id="last">Last</button>
                <button disabled>Disabled</button>
                <button disabled tabindex="0">Disabled with tabindex</button>
                <button tabindex="-1">Skipped</button>
                <div hidden><button>Hidden</button></div>
                <div inert><button>Inert</button></div>
                <button style="display: none">Undisplayed</button>
                <button style="visibility: hidden">Invisible</button>
                <input type="hidden" name="trailing" />
            `);
        });

        it('wraps Tab from the last reachable control to the first', () => {
            const trap = useFocusTrap(ref<HTMLElement | null>(container));

            trap.activate();
            (container.querySelector<HTMLElement>('#last') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('first');

            trap.deactivate();
        });

        it('wraps Shift+Tab from the first reachable control to the last', () => {
            const trap = useFocusTrap(ref<HTMLElement | null>(container));

            trap.activate();

            expect(document.activeElement?.id).toBe('first');

            pressKey('Tab', true);

            expect(document.activeElement?.id).toBe('last');

            trap.deactivate();
        });

        it.each([
            [false, 'first'],
            [true, 'last'],
        ])('moves Tab (shift %s) from a non-tabbable element back into the cycle at %s', (shiftKey, expected) => {
            const trap = useFocusTrap(ref<HTMLElement | null>(container));

            trap.activate();
            (container.querySelector<HTMLElement>('[tabindex="-1"]') as HTMLElement).focus();
            pressKey('Tab', shiftKey);

            expect(document.activeElement?.id).toBe(expected);

            trap.deactivate();
        });
    });

    describe('repeated activation', () => {
        it('returns focus to the original trigger and leaves no listener behind', () => {
            const trigger = buildContainer('<button id="trigger">Trigger</button>');

            (trigger.firstElementChild as HTMLElement).focus();
            container = buildContainer('<button id="a">A</button><button id="b">B</button>');

            const trap = useFocusTrap(ref<HTMLElement | null>(container));

            const added = vi.spyOn(document, 'addEventListener');
            const removed = vi.spyOn(document, 'removeEventListener');

            trap.activate();
            trap.activate();
            trap.deactivate();

            expect(document.activeElement?.id).toBe('trigger');
            expect(container.hasAttribute('tabindex')).toBe(false);
            expect(removed.mock.calls).toStrictEqual(added.mock.calls);

            added.mockRestore();
            removed.mockRestore();

            (container.querySelector<HTMLElement>('#b') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('b');

            trigger.remove();
        });

        it('moves the trap to a replaced container', () => {
            const trigger = buildContainer('<button id="trigger">Trigger</button>');
            const replacement = buildContainer('<button id="c">C</button><button id="d">D</button>');

            (trigger.firstElementChild as HTMLElement).focus();
            container = buildContainer('<button id="a">A</button><button id="b">B</button>');

            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            el.value = replacement;
            trap.activate();

            expect(document.activeElement?.id).toBe('c');

            (container.querySelector<HTMLElement>('#b') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('c');

            (replacement.querySelector<HTMLElement>('#d') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('c');

            trap.deactivate();

            expect(document.activeElement?.id).toBe('trigger');

            trigger.remove();
            replacement.remove();
        });
    });

    describe('container ref changed before deactivate', () => {
        it('releases the original container when the ref was nulled', () => {
            const trigger = buildContainer('<button id="trigger">Trigger</button>');

            (trigger.firstElementChild as HTMLElement).focus();
            container = buildContainer('<button id="a">A</button><button id="b">B</button>');

            const el = ref<HTMLElement | null>(container);
            const trap = useFocusTrap(el);

            trap.activate();
            el.value = null;

            expect(() => trap.deactivate()).not.toThrow();
            expect(document.activeElement?.id).toBe('trigger');

            (container.querySelector<HTMLElement>('#b') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('b');

            trigger.remove();
        });
    });

    describe('nested traps', () => {
        it('lets only the innermost active trap handle Tab', () => {
            container = buildContainer(`
                <button id="outer-first">Outer first</button>
                <div id="inner">
                    <button id="inner-first">Inner first</button>
                    <button id="inner-last">Inner last</button>
                </div>
            `);

            const inner = container.querySelector<HTMLElement>('#inner') as HTMLElement;
            const outerTrap = useFocusTrap(ref<HTMLElement | null>(container));
            const innerTrap = useFocusTrap(ref<HTMLElement | null>(inner));

            outerTrap.activate();
            innerTrap.activate();

            (inner.querySelector<HTMLElement>('#inner-last') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('inner-first');

            pressKey('Tab', true);

            expect(document.activeElement?.id).toBe('inner-last');

            innerTrap.deactivate();

            expect(document.activeElement?.id).toBe('outer-first');

            (inner.querySelector<HTMLElement>('#inner-last') as HTMLElement).focus();
            pressKey('Tab');

            expect(document.activeElement?.id).toBe('outer-first');

            outerTrap.deactivate();
        });

        it('keeps focus on an inner trap with nothing tabbable', () => {
            container = buildContainer(`
                <button id="outer-first">Outer first</button>
                <div id="inner"><p>Nothing to focus</p></div>
            `);

            const inner = container.querySelector<HTMLElement>('#inner') as HTMLElement;
            const outerTrap = useFocusTrap(ref<HTMLElement | null>(container));
            const innerTrap = useFocusTrap(ref<HTMLElement | null>(inner));

            outerTrap.activate();
            innerTrap.activate();

            expect(pressKey('Tab').defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(inner);

            innerTrap.deactivate();
            outerTrap.deactivate();
        });
    });
});
