// The shipped crc-sync facility config and class-dependent permission, built once from the factories
// (crc-sync/src/efsp/facility-config.js's createFacilityConfig, permission.js's createPermission) so the client parity
// tests read the same answers the server gives. The factory results are merged over the modules' static exports, so
// `facilityConfig.getAllBays()` and `permission.PERMISSIONS` / `permission.OP_KINDS` both work as they did when these
// were module singletons. Mirrors crc-sync/tests/helpers/permission.mjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const facilityModule = require('../../../crc-sync/src/efsp/facility-config.js');
const permissionModule = require('../../../crc-sync/src/efsp/permission.js');
const authority = require('../../../crc-sync/src/efsp/authority/index.js');

const facilityInstance = facilityModule.createFacilityConfig();
export const facilityConfig = { ...facilityModule, ...facilityInstance };
export const classOf = facilityInstance.getPositionClass;
export const permission = { ...permissionModule, ...permissionModule.createPermission({ classOf }) };
/** authority.airspaceRowOf as it was: the airspace row a Position gets under the shipped classes. */
export const airspaceRowOf = (positionId) => authority.airspaceRowFor(positionId, classOf);
