/**
 * Focus trap composable the host drives; it installs no Vue lifecycle hooks.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Ref } from 'vue';

const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';

// Editable content inside an editable host shares the host's single tab stop.
const SKIPPED_SELECTOR = `[tabindex^="-"], :disabled, ${EDITABLE_SELECTOR} ${EDITABLE_SELECTOR}:not([tabindex])`;

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'iframe',
    'audio[controls]',
    'video[controls]',
    'details > summary:first-of-type',
    EDITABLE_SELECTOR,
    '[tabindex]',
].join(', ');

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
     * `activate`, if it is still attached to the document and no trap activated
     * later is still open.
     */
    deactivate(): void;
}

/**
 * The live state of one activated trap.
 */
interface ActiveTrap {
    /** The container focus is kept inside. */
    readonly element: HTMLElement;

    /** The document-level keydown listener keeping Tab inside `element`. */
    readonly listener: (event: KeyboardEvent) => void;

    /** Whether the trap added `tabindex="-1"` to make `element` focusable. */
    addedTabIndex: boolean;
}

/** Active traps in activation order; only the latest one still in the document handles Tab. */
const trapStack: ActiveTrap[] = [];

/**
 * Collect every descendant of `container` that sequential Tab navigation can
 * reach, in DOM order; positive tabindex ordering, radio groups and shadow
 * roots are not modelled.
 */
function getTabbable(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        el =>
            !el.matches(SKIPPED_SELECTOR) &&
            el.closest('[hidden], [inert]') === null &&
            el.checkVisibility({ visibilityProperty: true }),
    );
}

/**
 * Focus the trap's container, first making it focusable with a temporary
 * `tabindex="-1"` when it has no tabindex of its own.
 */
function focusContainer(trap: ActiveTrap): void {
    if (!trap.element.hasAttribute('tabindex')) {
        trap.element.setAttribute('tabindex', '-1');
        trap.addedTabIndex = true;
    }

    trap.element.focus();
}

/**
 * Wrap Shift+Tab on the first tabbable element to the last and Tab on the last
 * to the first; from anywhere else outside the tabbable set, including the
 * container itself or the body after the focused control was removed, move to
 * the first or last, or to the container when nothing is tabbable, so focus
 * never leaves.
 */
function handleTrapKeydown(event: KeyboardEvent, trap: ActiveTrap): void {
    const tabbable = getTabbable(trap.element);
    const target = event.shiftKey ? tabbable.at(-1) : tabbable[0];
    const boundary = event.shiftKey ? tabbable[0] : tabbable.at(-1);

    if (target === undefined) {
        event.preventDefault();
        focusContainer(trap);

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
    trap.element.ownerDocument.removeEventListener('keydown', trap.listener);

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

        const active: ActiveTrap = {
            element: el,
            listener: (event: KeyboardEvent): void => {
                if (event.key === 'Tab' && trapStack.findLast(entry => entry.element.isConnected) === active) {
                    handleTrapKeydown(event, active);
                }
            },
            addedTabIndex: false,
        };

        el.ownerDocument.addEventListener('keydown', active.listener);
        trapStack.push(active);
        trap = active;

        const firstTabbable = getTabbable(el)[0];

        if (firstTabbable === undefined) {
            focusContainer(active);
        } else {
            firstTabbable.focus();
        }
    }

    /**
     * Stop intercepting Tab and, unless a trap activated later is still open,
     * restore focus to the pre-activation element.
     */
    function deactivate(): void {
        const isTop = trap === trapStack.at(-1);

        release();

        if (isTop && previouslyFocused?.isConnected) {
            previouslyFocused.focus();
        }

        previouslyFocused = null;
    }

    return { activate, deactivate };
}
