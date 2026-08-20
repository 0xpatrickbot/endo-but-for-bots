// @ts-check

// Thunk module for the public provisioning surface. It re-exports a strict
// subset of `./src/provision-client.js`: connection internals
// (`makeProvisionCapTpOptions`) stay out of the public thunk, and the
// host-side realizer is reachable only as `E(host).provision(...)`.

export {
  EndoCredentialUnavailableError,
  normalizeEndoProvisionSpec,
  provisionEndoGuest,
  reconstructEndoGuest,
  validateEndoProvisionPersistence,
} from './src/provision-client.js';
