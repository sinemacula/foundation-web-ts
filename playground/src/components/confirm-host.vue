<!--
    Confirmation dialog host for the kernel ConfirmService's active request;
    traps focus while open and cancels on Escape.

    @author Ben Carey <bdmc@sinemacula.co.uk>
    @copyright 2026 Sine Macula Limited
-->

<script setup lang="ts">
import SmButton from '@/components/ui/sm-button.vue';
import SmCard from '@/components/ui/sm-card.vue';
import { useI18n } from 'vue-i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { useFocusTrap } from '@sinemacula/web-core/composables/use-focus-trap';
import { confirmDialogs } from '@/services/confirm';

const { t } = useI18n();
const service = confirmDialogs();

// A list so each rendered dialog closes over its own request rather than whichever is active on click.
const requests = computed(() => (service.active.value === null ? [] : [service.active.value]));
const dialogRefs = ref<HTMLElement[]>([]);
// Holds the element the trap was engaged on until release, as unmounting empties dialogRefs first.
const trapTarget = ref<HTMLElement | null>(null);
const trap = useFocusTrap(trapTarget);

/** The id of the request already answered from this host, if any. */
const answeredId = ref<string | null>(null);

/**
 * Re-engage the focus trap on the rendered dialog for the active request.
 */
function syncTrap(): void {
    trap.deactivate();
    trapTarget.value = dialogRefs.value[0] ?? null;

    if (service.active.value !== null) {
        trap.activate();
    }
}

/**
 * Answer the request with the given id once; a stale or repeated answer is ignored.
 */
function answer(id: string, outcome: boolean): void {
    if (answeredId.value === id || service.active.value?.id !== id) {
        return;
    }

    answeredId.value = id;
    service.settle(outcome);
}

/**
 * Answer the request "no" when Escape is pressed inside its dialog.
 */
function onKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'Escape') {
        answer(id, false);
    }
}

watch(() => service.active.value, syncTrap, { flush: 'post' });
onMounted(syncTrap);
onBeforeUnmount(trap.deactivate);
</script>

<template>
    <div
        v-for="request in requests"
        :key="request.id"
        ref="dialogRefs"
        class="confirm-host"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="`confirm-title-${request.id}`"
        :aria-describedby="`confirm-message-${request.id}`"
        @keydown="onKeydown($event, request.id)"
    >
        <SmCard class="confirm-host__panel">
            <h2 :id="`confirm-title-${request.id}`" class="confirm-host__title">
                {{ t(request.title) }}
            </h2>
            <p :id="`confirm-message-${request.id}`" class="confirm-host__message">
                {{ t(request.message) }}
            </p>
            <div class="confirm-host__actions">
                <SmButton variant="ghost" :disabled="answeredId === request.id" @click="answer(request.id, false)">
                    {{ t(request.cancelLabel ?? 'common.actions.cancel') }}
                </SmButton>
                <SmButton :disabled="answeredId === request.id" @click="answer(request.id, true)">
                    {{ t(request.confirmLabel ?? 'common.actions.confirm') }}
                </SmButton>
            </div>
        </SmCard>
    </div>
</template>

<style scoped>
.confirm-host {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sm-space-4);
    background: rgb(15 23 42 / 40%);
}

.confirm-host__panel {
    width: 100%;
    max-width: 26rem;
}

.confirm-host__title {
    margin-bottom: var(--sm-space-4);
    color: var(--sm-text-strong);
    font-size: var(--sm-text-lg);
    font-weight: 600;
}

.confirm-host__message {
    color: var(--sm-text-body);
    font-size: var(--sm-text-sm);
}

.confirm-host__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--sm-space-2);
    margin-top: var(--sm-space-5);
}
</style>
