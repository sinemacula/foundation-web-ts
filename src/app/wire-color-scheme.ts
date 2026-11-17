/**
 * Colour-scheme wiring for the bootstrap preset.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { KeyValueStorage } from '@sinemacula/foundation/storage/key-value-storage';
import type { ColorSchemePreference } from '@sinemacula/foundation/theme/color-scheme';
import { ColorSchemeService } from '@sinemacula/foundation/theme/color-scheme-service';
import { DomColorSchemeApplier, type ThemeColors } from '../theme/dom-color-scheme-applier';
import { MatchMediaColorSchemeSource } from '../theme/matchmedia-color-scheme-source';
import { installColorScheme } from './services';

/**
 * The configuration slice the colour-scheme wiring reads.
 */
export interface ColorSchemeWiringConfig {
    /** Colour-scheme settings. */
    readonly colorScheme: {
        /** The preference applied before any stored choice resolves. */
        readonly default: ColorSchemePreference;
    };
}

/**
 * Options for {@link wireColorScheme}.
 */
export interface WireColorSchemeOptions {
    /** The configuration slice the colour-scheme wiring reads. */
    readonly config: ColorSchemeWiringConfig;

    /** The storage the preference is read from and persisted to. */
    readonly storage: KeyValueStorage;

    /** The storage key the preference persists under. Default 'theme'. */
    readonly colorSchemeStorageKey?: string;

    /** The surface-page colours applied to the `theme-color` meta tag. */
    readonly themeColors?: ThemeColors;

    /** The window whose `matchMedia` sources the OS scheme. */
    readonly targetWindow: Window;

    /** The document whose root and head receive the applied scheme. */
    readonly targetDocument?: Document;

    /** Receives a throwing listener or a failed storage read. */
    readonly onError?: (error: unknown) => void;
}

/**
 * Start the colour-scheme service and install it as the singleton.
 */
export function wireColorScheme(options: WireColorSchemeOptions): ColorSchemeService {
    const config = options.config;
    const source = new MatchMediaColorSchemeSource(options.targetWindow);
    const applier = new DomColorSchemeApplier({
        ...(options.targetDocument === undefined ? {} : { targetDocument: options.targetDocument }),
        ...(options.themeColors === undefined ? {} : { themeColors: options.themeColors }),
    });
    const service = new ColorSchemeService({
        storage: options.storage,
        source,
        applier,
        defaultPreference: config.colorScheme.default,
        ...(options.colorSchemeStorageKey === undefined ? {} : { storageKey: options.colorSchemeStorageKey }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
    });

    service.start();

    installColorScheme(service);

    return service;
}
