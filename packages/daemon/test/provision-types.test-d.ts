import { expectTypeOf } from 'expect-type';

import {
  provisionEndoGuest,
  reconstructEndoGuest,
  type EndoProvisionPersistence,
  type EndoProvisionResult,
  type EndoProvisionSpec,
} from '@endo/daemon/provision.js';

declare const persistence: EndoProvisionPersistence;
declare const spec: EndoProvisionSpec;

expectTypeOf(
  provisionEndoGuest({
    scope: 'types',
    sessionId: 'session',
    cwd: '/workspace',
    spec,
  }),
).toEqualTypeOf<Promise<EndoProvisionResult>>();

expectTypeOf(reconstructEndoGuest({ persistence })).toEqualTypeOf<
  Promise<EndoProvisionResult>
>();
expectTypeOf(persistence.version).toEqualTypeOf<1>();
expectTypeOf<EndoProvisionResult['guest']>().not.toBeAny();

// Prompt and harness fields belong to the Agentry adapter, not daemon policy.
const harnessPolicy: EndoProvisionSpec = {
  // @ts-expect-error daemon provisioning does not accept Pi lifecycle configuration
  piTools: 'preserve',
};
expectTypeOf(harnessPolicy).toEqualTypeOf<EndoProvisionSpec>();

const workspaceGrant: EndoProvisionSpec = {
  workspace: { path: '.', mode: 'readOnly', deniedSegments: ['.git'] },
};
expectTypeOf(workspaceGrant).toEqualTypeOf<EndoProvisionSpec>();
