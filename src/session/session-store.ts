/**
 * Pinia binding over the foundation session core transitions.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { Pinia } from 'pinia';
import { defineStore } from 'pinia';
import type { Ref } from 'vue';
import { customRef } from 'vue';

import type { PasswordCredentials } from '@sinemacula/foundation/session/session-api';
import {
    clearSession,
    createInitialSessionState,
    hydrateSession,
    loginWithCredentials,
    logoutSession,
    refreshSession,
    rehydrateSessionUser,
    sessionIdentity,
} from '@sinemacula/foundation/session/session-core';
import type { LoginOutcome, RefreshOutcome } from '@sinemacula/foundation/session/session-outcomes';
import type { SessionState } from '@sinemacula/foundation/session/session-state';
import type { SessionUser } from '@sinemacula/foundation/session/session-user';
import { sessionContext } from './session-context';

/**
 * The session store contract consumed by guards, authorization checks and the
 * session module's lifecycle wiring.
 */
export interface SessionStore<U extends SessionUser = SessionUser, C = PasswordCredentials> {
    /** The bearer token for the active session, or null when signed out. */
    readonly accessToken: string | null;

    /** The refresh token for the active session, or null when not held. */
    readonly refreshToken: string | null;

    /** Absolute access-token expiry in epoch milliseconds, or null when unknown. */
    readonly expiresAtEpochMs: number | null;

    /** The authenticated user record, or null when not yet loaded. */
    readonly user: U | null;

    /** Whether an access token is present. */
    readonly isAuthenticated: boolean;

    /**
     * The identity of the held session, compared by reference, or null when
     * signed out. It survives every rotation, including one another tab
     * persisted, and is new for every sign-in, even over the same tokens;
     * reading it inside a watcher tracks it.
     */
    sessionIdentity(): object | null;

    /**
     * Bring the state in line with the persisted session. Another tab's
     * rotation of the held session only updates its tokens; another sign-in
     * replaces the session and drops the user. A persistence failure rejects.
     */
    hydrate(): Promise<void>;

    /**
     * Exchange credentials for a session, persist it, and load the user,
     * presenting the held refresh token so the server can supersede that
     * session. Only an `authenticated` outcome is a completed sign-in.
     */
    login(credentials: C): Promise<LoginOutcome>;

    /**
     * Exchange the refresh credential for a new session, first adopting a
     * rotation another tab persisted instead of presenting a spent token. A
     * refusal clears the session; a transient or other failure keeps it.
     */
    refresh(): Promise<RefreshOutcome>;

    /**
     * Discard the session locally at once, then best-effort sign it out
     * server-side with its own tokens, unless a newer sign-in has been
     * persisted meanwhile.
     */
    logout(): Promise<void>;

    /**
     * Discard the session locally without calling the server. State is cleared
     * before the promise settles; a persistence failure rejects.
     */
    clearLocal(): Promise<void>;

    /**
     * Fetch the user when a session is held but no user is loaded yet. Shared
     * by concurrent callers; failures are swallowed.
     */
    rehydrateUser(): Promise<void>;

    /**
     * Stop the store's effect scope; composed into application disposal.
     */
    $dispose(): void;
}

/**
 * Resolve the session store under the installed context's store id, on the
 * given pinia or else the active one.
 */
export function useSessionStore<U extends SessionUser = SessionUser, C = PasswordCredentials>(
    pinia?: Pinia,
): SessionStore<U, C> {
    return sessionStoreDefinition(sessionContext().storeId)(pinia) as unknown as SessionStore<U, C>;
}

/**
 * Define the session store under the given id.
 */
function sessionStoreDefinition(id: string): (pinia?: Pinia) => SessionStore<SessionUser, unknown> {
    const definition = defineStore(id, {
        state: (): SessionState => createInitialSessionState(),

        getters: {
            isAuthenticated: (state): boolean => state.accessToken !== null,
        },

        actions: {
            sessionIdentity(): object | null {
                return observed(this.$state).identity.value;
            },

            hydrate(): Promise<void> {
                return hydrateSession(observed(this.$state).state, sessionContext());
            },

            login(credentials: unknown): Promise<LoginOutcome> {
                return loginWithCredentials(
                    observed(this.$state).state,
                    sessionContext<SessionUser, unknown>(),
                    credentials,
                );
            },

            refresh(): Promise<RefreshOutcome> {
                return refreshSession(observed(this.$state).state, sessionContext());
            },

            logout(): Promise<void> {
                return logoutSession(observed(this.$state).state, sessionContext());
            },

            clearLocal(): Promise<void> {
                return clearSession(observed(this.$state).state, sessionContext());
            },

            rehydrateUser(): Promise<void> {
                return rehydrateSessionUser(observed(this.$state).state, sessionContext());
            },
        },
    });

    return definition as unknown as (pinia?: Pinia) => SessionStore<SessionUser, unknown>;
}

/** A store state seen through a view that notifies every write. */
interface ObservedState {
    /** The state the core transitions run over. */
    readonly state: SessionState;

    /** The session identity, re-read on every write to the state. */
    readonly identity: Readonly<Ref<object | null>>;
}

const observedStates = new WeakMap<SessionState, ObservedState>();

/**
 * Resolve the observed view of a store state, the same one on every call, as
 * the core keys its bookkeeping by the state object's identity.
 */
function observed(state: SessionState): ObservedState {
    let entry = observedStates.get(state);

    if (entry === undefined) {
        let view = state;

        const identity = customRef<object | null>((track, trigger) => {
            view = new Proxy(state, {
                /**
                 * Write through, then notify the identity's watchers.
                 *
                 * @imperative
                 */
                set: (target, key, value): boolean => {
                    const written = Reflect.set(target, key, value);

                    trigger();

                    return written;
                },
            });

            return {
                get: (): object | null => {
                    track();

                    return sessionIdentity(view);
                },
                set: trigger,
            };
        });

        entry = { state: view, identity };
        observedStates.set(state, entry);
    }

    return entry;
}
