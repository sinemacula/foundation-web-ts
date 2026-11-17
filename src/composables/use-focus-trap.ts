/**
 * Focus trap composable the host drives; it installs no Vue lifecycle hooks.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Ref } from 'vue';

const FOCUSABLE_SELECTOR = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

/**
 * Controls returned by {@link useFocusTrap}.
 */
export interface FocusTrapControls {
    /**
     * Focus the container's first tabbable descendant, or the container itself
     * when it has none, and keep Tab / Shift+Tab inside it. Calling it again
     * while active re-targets the trap to the current container and keeps the
     * original element to restore focus to.
     */
    activate(): void;

    /**
     * Stop trapping and restore focus to the element active before the first
     * `activate`, if it is still attached to the document.
     */
    deactivate(): void;
}

/**
 * The live state of one activated trap.
 */
interface ActiveTrap {
    /** The element the keydown listener is attached to. */
    readonly element: HTMLElement;

    /** The keydown listener wrapping Tab inside `element`. */
    readonly listener: (event: KeyboardEvent) => void;

    /** Whether activation added `tabindex="-1"` to make `element` focusable. */
    readonly addedTabIndex: boolean;
}

/** Active traps in activation order; only the most recent one handles Tab. */
const trapStack: ActiveTrap[] = [];

/**
 * Collect every descendant of `container` that sequential Tab navigation can
 * reach, in DOM order; positive tabindex ordering, radio groups and shadow
 * roots are not modelled.
 */
function getTabbable(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        el =>
            el.tabIndex >= 0 &&
            !el.matches(':disabled') &&
            el.closest('[hidden], [inert]') === null &&
            el.checkVisibility({ visibilityProperty: true }),
    );
}

/**
 * Wrap Shift+Tab on the first tabbable element to the last and Tab on the last
 * to the first; from anywhere else outside the tabbable set, including the
 * container itself, move to the first or last, so focus never leaves.
 */
function handleTrapKeydown(event: KeyboardEvent, container: HTMLElement): void {
    const tabbable = getTabbable(container);
    const target = event.shiftKey ? tabbable.at(-1) : tabbable[0];
    const boundary = event.shiftKey ? tabbable[0] : tabbable.at(-1);

    if (target === undefined) {
        event.preventDefault();

        return;
    }

    const active = document.activeElement as HTMLElement;

    if (active === boundary || !tabbable.includes(active)) {
        event.preventDefault();
        target.focus();
    }
}

/**
 * Detach a trap's keydown listener, undo its container tabindex and remove it
 * from the trap stack.
 */
function releaseTrap(trap: ActiveTrap): void {
    trap.element.removeEventListener('keydown', trap.listener);

    if (trap.addedTabIndex) {
        trap.element.removeAttribute('tabindex');
    }

    trapStack.splice(trapStack.indexOf(trap), 1);
}

/**
 * Create a focus trap the host activates once the container has rendered and
 * deactivates when it hides; when traps nest, only the latest one handles Tab.
 */
export function useFocusTrap(container: Ref<HTMLElement | null>): FocusTrapControls {
    let previouslyFocused: HTMLElement | null = null;
    let trap: ActiveTrap | null = null;

    /**
     * Release the current trap, if any.
     */
    function release(): void {
        if (trap !== null) {
            releaseTrap(trap);
            trap = null;
        }
    }

    /**
     * Remember the active element on first activation, focus the first target
     * and intercept Tab.
     */
    function activate(): void {
        const el = container.value;

        if (el === null) {
            return;
        }

        if (trap === null && document.activeElement instanceof HTMLElement) {
            previouslyFocused = document.activeElement;
        }

        release();

        const firstTabbable = getTabbable(el)[0];
        const addedTabIndex = firstTabbable === undefined && !el.hasAttribute('tabindex');

        if (addedTabIndex) {
            el.setAttribute('tabindex', '-1');
        }

        const active: ActiveTrap = {
            element: el,
            listener: (event: KeyboardEvent): void => {
                if (event.key === 'Tab' && trapStack.at(-1) === active) {
                    handleTrapKeydown(event, el);
                }
            },
            addedTabIndex,
        };

        el.addEventListener('keydown', active.listener);
        trapStack.push(active);
        trap = active;

        (firstTabbable ?? el).focus();
    }

    /**
     * Stop intercepting Tab and restore focus to the pre-activation element.
     */
    function deactivate(): void {
        release();

        if (previouslyFocused?.isConnected) {
            previouslyFocused.focus();
        }

        previouslyFocused = null;
    }

    return { activate, deactivate };
}
