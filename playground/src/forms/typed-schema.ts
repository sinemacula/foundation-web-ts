/**
 * Zod adapter for vee-validate 4, which cannot take a zod schema directly.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import type { TypedSchema, TypedSchemaError } from 'vee-validate';
import type * as z from 'zod';

/**
 * Wrap a zod object schema as a vee-validate `TypedSchema`; each path's first
 * issue message becomes its field error (a translation key).
 */
export function zodToTypedSchema<T extends z.ZodObject<z.ZodRawShape>>(
    schema: T,
): TypedSchema<z.input<T>, z.output<T>> {
    return {
        // biome-ignore lint/style/useNamingConvention: vee-validate contract
        __type: 'VVTypedSchema' as const,
        parse(values: z.input<T>): Promise<{
            /** The parsed output when validation succeeds. */
            value?: z.output<T>;

            /** The field errors, one entry per failing path. */
            errors: TypedSchemaError[];
        }> {
            const result = schema.safeParse(values);

            if (result.success) {
                return Promise.resolve({ value: result.data, errors: [] });
            }

            // zod emits one issue per failed check; keep the first per path.
            const seen = new Set<string>();
            const errors: TypedSchemaError[] = [];

            for (const issue of result.error.issues) {
                const dotPath = issue.path.map(String).join('.');

                if (!seen.has(dotPath)) {
                    seen.add(dotPath);
                    // Root issues omit `path` rather than set it undefined.
                    const entry: TypedSchemaError = dotPath
                        ? { path: dotPath, errors: [issue.message] }
                        : { errors: [issue.message] };

                    errors.push(entry);
                }
            }

            return Promise.resolve({ errors });
        },
    };
}
