/**
 * Login form state, validation and submission.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import { HttpError, HttpValidationError } from '@sinemacula/foundation/http/http-error';
import type { LoginOutcome, PendingAuthentication } from '@sinemacula/foundation/session/session-outcomes';
import { useSessionStore } from '@sinemacula/web-core/session/session-store';
import { useForm } from 'vee-validate';
import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';
import * as z from 'zod';

import { applyServerValidationErrors } from '@/forms/server-errors';
import { zodToTypedSchema } from '@/forms/typed-schema';

const loginSchema = z.object({
    email: z.string().min(1, 'auth.login.validation.emailRequired').email('auth.login.validation.emailInvalid'),
    password: z.string().min(1, 'auth.login.validation.passwordRequired'),
});

/**
 * Reactive state and submission behaviour for the login screen.
 */
export interface LoginForm {
    /** The email field's reactive value. */
    readonly email: Ref<string>;

    /** The password field's reactive value. */
    readonly password: Ref<string>;

    /** Translation key for the email field error, or '' when valid/untouched. */
    readonly emailError: ComputedRef<string>;

    /** Translation key for the password field error, or '' when valid/untouched. */
    readonly passwordError: ComputedRef<string>;

    /** Form-level (API) error translation key, or null when none. */
    readonly error: Ref<string | null>;

    /** The pending session of a sign-in that owes a further step, or null. */
    readonly pending: Ref<PendingAuthentication | null>;

    /** True while a submission is in flight. */
    readonly isSubmitting: ComputedRef<boolean> | Ref<boolean>;

    /**
     * Validates first; returns true only when the sign-in authenticated.
     */
    submit(): Promise<boolean>;
}

/**
 * Build the login form state and submission behaviour.
 */
export function useLoginForm(): LoginForm {
    const { isSubmitting, defineField, errors, validate, setErrors } = useForm({
        validationSchema: zodToTypedSchema(loginSchema),
        initialValues: { email: '', password: '' },
    });

    const [email] = defineField('email');
    const [password] = defineField('password');

    const emailError = computed(() => errors.value.email ?? '');
    const passwordError = computed(() => errors.value.password ?? '');

    const error = ref<string | null>(null);
    const pending = ref<PendingAuthentication | null>(null);
    const inFlight = ref(false);

    /**
     * Validate, then log in; re-entrant calls are ignored while one is in
     * flight.
     */
    const submit = async (): Promise<boolean> => {
        if (inFlight.value) {
            return false;
        }

        inFlight.value = true;

        try {
            return await attemptLogin({
                validate,
                login: () => useSessionStore().login({ email: email.value, password: password.value }),
                applyServerErrors: caught => applyServerValidationErrors(caught, setErrors),
                error,
                pending,
            });
        } finally {
            inFlight.value = false;
        }
    };

    return { email, password, emailError, passwordError, error, pending, isSubmitting, submit };
}

/**
 * The callbacks {@link attemptLogin} needs from the form to run one attempt.
 */
interface LoginAttempt {
    /** Run field validation and report whether the inputs are valid. */
    readonly validate: () => Promise<{
        /** Whether the current inputs pass validation. */
        valid: boolean;
    }>;

    /** Perform the session login with the current credentials. */
    readonly login: () => Promise<LoginOutcome>;

    /** Surface a caught failure as field errors; returns true when it did. */
    readonly applyServerErrors: (caught: unknown) => boolean;

    /** The form-level error key sink. */
    readonly error: Ref<string | null>;

    /** The pending session sink. */
    readonly pending: Ref<PendingAuthentication | null>;
}

/**
 * Validate the inputs and, when valid, attempt the session login.
 */
async function attemptLogin(attempt: LoginAttempt): Promise<boolean> {
    const { valid } = await attempt.validate();

    if (!valid) {
        return false;
    }

    try {
        attempt.error.value = null;
        attempt.pending.value = null;

        const outcome = await attempt.login();

        if (outcome.kind === 'interactionRequired') {
            attempt.pending.value = outcome.pending;
        }

        return outcome.kind === 'authenticated';
    } catch (caught) {
        if (!attempt.applyServerErrors(caught)) {
            attempt.error.value = resolveLoginErrorKey(caught);
        }

        return false;
    }
}

/**
 * Map a login failure onto a translation key.
 */
export function resolveLoginErrorKey(caught: unknown): string {
    if (caught instanceof HttpValidationError || (caught instanceof HttpError && caught.status === 401)) {
        return 'auth.login.errors.invalid';
    }

    return 'common.states.error';
}
