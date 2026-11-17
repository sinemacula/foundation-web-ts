/**
 * Focus trap composable the host drives; it installs no Vue lifecycle hooks.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Ref } from 'vue';

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Controls returned by {@link useFocusTrap}.
 */
export interface FocusTrapControls {
    /**
     * Focus the container's first focusable descendant and wrap Tab / Shift+Tab
     * at its boundaries; no-op when it holds nothing focusable.
     */
    activate(): void;

    /**
     * Stop trapping and restore focus to the element active before `activate`,
     * if it is still attached to the document.
     */
    deactivate(): void;
}

/**
 * Collect every focusable descendant of `container` in DOM order.
 */
function getFocusable(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Wrap Shift+Tab on the first focusable element to the last, and Tab on the
 * last to the first.
 */
function handleTrapKeydown(event: KeyboardEvent, container: HTMLElement): void {
    const focusable = getFocusable(container);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (first === undefined || last === undefined) {
        return;
    }

    if (event.shiftKey) {
        if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
    } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

/**
 * Create a focus trap the host activates when the container shows and
 * deactivates when it hides.
 */
export function useFocusTrap(container: Ref<HTMLElement | null>): FocusTrapControls {
    let previouslyFocused: HTMLElement | null = null;
    let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

    /**
     * Remember the active element, focus the first target and intercept Tab.
     */
    function activate(): void {
        const el = container.value;

        if (el === null) {
            return;
        }

        const focusable = getFocusable(el);
        const firstFocusable = focusable[0];

        if (firstFocusable === undefined) {
            return;
        }

        if (document.activeElement instanceof HTMLElement) {
            previouslyFocused = document.activeElement;
        }
        firstFocusable.focus();

        keydownHandler = (event: KeyboardEvent): void => {
            if (event.key === 'Tab') {
                handleTrapKeydown(event, el);
            }
        };

        el.addEventListener('keydown', keydownHandler);
    }

    /**
     * Stop intercepting Tab and restore focus to the pre-activation element.
     */
    function deactivate(): void {
        const el = container.value;

        if (el !== null && keydownHandler !== null) {
            el.removeEventListener('keydown', keydownHandler);
        }

        keydownHandler = null;

        if (previouslyFocused?.isConnected) {
            previouslyFocused.focus();
        }

        previouslyFocused = null;
    }

    return { activate, deactivate };
}
