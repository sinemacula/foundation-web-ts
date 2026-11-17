<!--
    Fixed top progress bar shown while a router navigation is in flight.

    @author Ben Carey <bdmc@sinemacula.co.uk>
    @copyright 2026 Sine Macula Limited
-->

<script setup lang="ts">
import { createNavigationProgress } from '@sinemacula/web-core/router/navigation-progress';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const { t } = useI18n();
const progress = createNavigationProgress(useRouter());
</script>

<template>
    <div
        v-if="progress.isNavigating.value"
        class="navigation-progress"
        role="progressbar"
        :aria-label="t('common.states.loading')"
    />
</template>

<style scoped>
.navigation-progress {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 100;
    width: 100%;
    height: 3px;
    background: var(--sm-accent);
    animation: navigation-progress-indeterminate 1.2s ease-in-out infinite;
}

@keyframes navigation-progress-indeterminate {
    0% {
        transform: translateX(-100%) scaleX(0.4);
    }

    50% {
        transform: translateX(0%) scaleX(0.6);
    }

    100% {
        transform: translateX(100%) scaleX(0.4);
    }
}
</style>
