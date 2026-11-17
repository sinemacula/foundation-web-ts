/**
 * Session store.
 *
 * The pinia binding over the foundation session core. State starts signed out
 * and every action forwards the store's one state object plus the installed
 * session context into the core transitions, which key their bookkeeping by
 * that object's identity; nothing else writes the persisted session. That
 * object notifies every write, so the session identity the core keeps outside
 * the state can be watched.
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
     * The identity of the held session, or null when signed out. It survives a
     * rotation and is new for every sign-in or adoption, even over the same
     * tokens; reading it inside a watcher tracks it.
     *
     * @returns the session identity, compared by reference
     */
    sessionIdentity(): object | null;

    /**
     * Bring the state in line with the persisted session, adopting a session
     * another tab wrote and dropping the user when it does. A persistence
     * failure rejects.
     */
    hydrate(): Promise<void>;

    /**
     * Exchange credentials for a session, persist it, and load the user.
     *
     * @param credentials - the login credentials, forwarded to the gateway
     * @returns what the sign-in did; only `authenticated` is a completed
     * sign-in
     */
    login(credentials: C): Promise<LoginOutcome>;

    /**
     * Exchange the refresh credential for a new session. A refusal clears the
     * session; a transient or other failure keeps it.
     *
     * @returns what the refresh did
     */
    refresh(): Promise<RefreshOutcome>;

    /**
     * Best-effort invalidate the session server-side, then discard it locally.
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
 * Resolve the session store over the installed session context.
 *
 * @param pinia - the pinia instance to resolve against; defaults to the active
 * instance
 * @returns the session store, registered under the context's store id
 */
export function useSessionStore<U extends SessionUser = SessionUser, C = PasswordCredentials>(
    pinia?: Pinia,
): SessionStore<U, C> {
    return sessionStoreDefinition(sessionContext().storeId)(pinia) as unknown as SessionStore<U, C>;
}

/**
 * Define the session store under the given id.
 *
 * @param id - the pinia store id from the session context
 * @returns the pinia store hook
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
 * Resolve the observed view of a store state, the same one on every call.
 *
 * @param state - the store state
 * @returns the observed state
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
