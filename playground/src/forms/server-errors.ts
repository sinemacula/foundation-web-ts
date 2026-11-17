/**
 * Maps a 422 validation failure onto vee-validate field errors.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { HttpValidationError } from '@sinemacula/foundation/http/http-error';

/**
 * Applies a field-name-to-message map to a form.
 */
export type FieldErrorSetter = (fields: Readonly<Record<string, string>>) => void;

/**
 * Apply each field's first server message to the form in one `setErrors` call.
 *
 * @returns false when nothing was applied, so the caller falls through to its
 * generic error handling
 */
export function applyServerValidationErrors(error: unknown, setErrors: FieldErrorSetter): boolean {
    if (!(error instanceof HttpValidationError)) {
        return false;
    }

    const fieldMessages: Record<string, string> = {};

    for (const [field, messages] of Object.entries(error.errors)) {
        const firstMessage = messages[0];

        if (firstMessage !== undefined) {
            fieldMessages[field] = firstMessage;
        }
    }

    if (Object.keys(fieldMessages).length === 0) {
        return false;
    }

    setErrors(fieldMessages);

    return true;
}
