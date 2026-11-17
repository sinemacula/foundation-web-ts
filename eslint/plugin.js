/**
 * The @sinemacula/web-core ESLint plugin; index.js enables its rules.
 *
 * @author      Ben Carey <bdmc@sinemacula.co.uk>
 * @copyright   2026 Sine Macula Limited
 */

import moduleExportNames from './rules/module-export-names.js';
import moduleImportBoundary from './rules/module-import-boundary.js';
import moduleNameMatchesFolder from './rules/module-name-matches-folder.js';
import noSnakeCaseKeys from './rules/no-snake-case-keys.js';
import routeNameNamespacing from './rules/route-name-namespacing.js';
import routeNameViaConstant from './rules/route-name-via-constant.js';

export default {
    meta: {
        name: '@sinemacula/web-core',
    },
    rules: {
        'module-name-matches-folder': moduleNameMatchesFolder,
        'module-export-names': moduleExportNames,
        'module-import-boundary': moduleImportBoundary,
        'route-name-namespacing': routeNameNamespacing,
        'route-name-via-constant': routeNameViaConstant,
        'no-snake-case-keys': noSnakeCaseKeys,
    },
};
