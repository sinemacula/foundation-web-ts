/**
 * Clipboard-write helper.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

/**
 * Write `text` to the system clipboard.
 *
 * Never throws: resolves false when the Clipboard API is unavailable (older
 * browsers, insecure origins) or `writeText` rejects (permission denied).
 *
 * @param targetNavigator - defaults to `globalThis.navigator`
 * @returns true once the text has been written
 */
export async function copyToClipboard(
    text: string,
    targetNavigator: Navigator = globalThis.navigator,
): Promise<boolean> {
    if (targetNavigator.clipboard === undefined) {
        return false;
    }

    try {
        await targetNavigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
