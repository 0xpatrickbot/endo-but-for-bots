// @ts-check

/**
 * Same-vat Filesystem posture registry.
 *
 * Only Filesystem factories in this package import the registration helper.
 * The public accessor is deliberately read-only: a caller cannot turn an
 * arbitrary object into a recognized reader or writer by adding a property,
 * declaration, or self-description method.
 */

/** @typedef {'readOnly' | 'readWrite'} FilesystemPosture */

/** @type {WeakMap<object, FilesystemPosture>} */
const filesystemPostures = new WeakMap();

/**
 * @param {object} filesystem
 * @param {FilesystemPosture} posture
 * @returns {object}
 */
export const registerFilesystemPosture = (filesystem, posture) => {
  filesystemPostures.set(filesystem, posture);
  return filesystem;
};
harden(registerFilesystemPosture);

/**
 * @param {unknown} filesystem
 * @returns {FilesystemPosture | undefined}
 */
export const filesystemPostureOf = filesystem =>
  typeof filesystem === 'object' && filesystem !== null
    ? filesystemPostures.get(filesystem)
    : undefined;
harden(filesystemPostureOf);
