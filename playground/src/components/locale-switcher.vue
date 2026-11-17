<!--
    Runtime locale switcher over the enabled locales.

    @author Ben Carey <bdmc@sinemacula.co.uk>
    @copyright 2026 Sine Macula Limited
-->

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import { config } from '@/services/config';
import { localeSwitcher } from '@/services/locale';

const { t } = useI18n();
const switcher = localeSwitcher();

/**
 * Request a switch to the locale selected in the native `<select>`.
 */
function onChange(event: Event): void {
    const locale = (event.target as HTMLSelectElement).value;

    switcher.switchTo(locale).catch(() => {
        // Unreachable: the <select> only lists enabled locales.
    });
}
</script>

<template>
    <div class="locale-switcher">
        <label for="locale-switcher-select" class="locale-switcher__label">
            {{ t('common.locale.label') }}
        </label>
        <select
            id="locale-switcher-select"
            class="locale-switcher__select"
            :value="switcher.current.value"
            @change="onChange"
        >
            <option v-for="locale in config().locales.enabled" :key="locale" :value="locale">
                {{ config().locales.supported[locale]?.name ?? locale }}
            </option>
        </select>
    </div>
</template>

<style scoped>
.locale-switcher {
    display: flex;
    align-items: center;
}

.locale-switcher__label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

.locale-switcher__select {
    padding: var(--sm-space-2) var(--sm-space-3);
    background: var(--sm-surface-raised);
    border: 1px solid var(--sm-border);
    border-radius: var(--sm-radius-md);
    color: var(--sm-text-body);
    font-size: var(--sm-text-sm);
}
</style>
