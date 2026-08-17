import { eslintCompatPlugin } from '@oxlint/plugins';

import { noConditionalEmptyObjectSpreadRule } from './rules/no-conditional-empty-object-spread.ts';
import { noModuleMockingRule } from './rules/no-module-mocking.ts';
import { noReflectApplyRule } from './rules/no-reflect-apply.ts';
import { noReflectGetRule } from './rules/no-reflect-get.ts';
import { noRuntimeTypeofRule } from './rules/no-runtime-typeof.ts';
import { noForbiddenTermInSymbolNamesRule } from './rules/no-shape-in-symbol-names.ts';

/** The six anti-slop rules that inspect JavaScript syntax. */
export default eslintCompatPlugin({
  meta: { name: 'anti-slop' },
  rules: {
    'no-conditional-empty-object-spread': noConditionalEmptyObjectSpreadRule,
    'no-module-mocking': noModuleMockingRule,
    'no-reflect-apply': noReflectApplyRule,
    'no-reflect-get': noReflectGetRule,
    'no-runtime-typeof': noRuntimeTypeofRule,
    'no-shape-in-symbol-names': noForbiddenTermInSymbolNamesRule,
  },
});
