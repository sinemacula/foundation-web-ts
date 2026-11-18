/**
 * Datetime and number formats per locale; currency follows the locale's market.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { LocaleFormats } from '@sinemacula/foundation-web/i18n/application-i18n';

export const localeFormats: LocaleFormats = {
    datetime: {
        'en-US': {
            short: { year: 'numeric', month: 'numeric', day: 'numeric' },
            long: {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
                hour: 'numeric',
                minute: 'numeric',
            },
        },
        'fr-FR': {
            short: { year: 'numeric', month: 'numeric', day: 'numeric' },
            long: {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long',
                hour: 'numeric',
                minute: 'numeric',
            },
        },
    },
    number: {
        'en-US': {
            currency: { style: 'currency', currency: 'USD' },
            decimal: { style: 'decimal' },
            percent: { style: 'percent' },
        },
        'fr-FR': {
            currency: { style: 'currency', currency: 'EUR' },
            decimal: { style: 'decimal' },
            percent: { style: 'percent' },
        },
    },
};
