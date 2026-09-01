export {
  ProjectMigrationError,
  upgradeSchema24To25,
  upgradeSchema24To25WithReport,
} from "./transforms/project.js";
export type {
  MigratedIndependentCellPin,
  PreservedLegacySharedNet,
  Schema24To25MigrationReport,
  Schema24To25MigrationResult,
} from "./transforms/project.js";
export {
  upgradeSchema25To26,
  upgradeSchema25To26WithReport,
} from "./transforms/route-leg.js";
export type {
  MigratedRouteLegPath,
  Schema25To26MigrationReport,
  Schema25To26MigrationResult,
} from "./transforms/route-leg.js";
export {
  upgradeSchema26To27,
  upgradeSchema26To27WithReport,
} from "./transforms/drafting-style.js";
export type {
  Schema26To27MigrationReport,
  Schema26To27MigrationResult,
} from "./transforms/drafting-style.js";
export {
  upgradeSchema27To28,
  upgradeSchema27To28WithReport,
} from "./transforms/polarity-drafting.js";
export type {
  Schema27To28MigrationReport,
  Schema27To28MigrationResult,
} from "./transforms/polarity-drafting.js";
export {
  upgradeSchema28To29,
  upgradeSchema28To29WithReport,
} from "./transforms/annotation-grid.js";
export type {
  Schema28To29MigrationReport,
  Schema28To29MigrationResult,
} from "./transforms/annotation-grid.js";
export {
  upgradeSchema29To30,
  upgradeSchema29To30WithReport,
} from "./transforms/formula-rich-text.js";
export type {
  Schema29To30MigrationReport,
  Schema29To30MigrationResult,
} from "./transforms/formula-rich-text.js";
export {
  upgradeSchema30To31,
  upgradeSchema30To31WithReport,
} from "./transforms/signal-flow-parameters.js";
export type {
  Schema30To31MigrationReport,
  Schema30To31MigrationResult,
} from "./transforms/signal-flow-parameters.js";
export {
  upgradeSchema31To32,
  upgradeSchema31To32WithReport,
} from "./transforms/annotation-text-color.js";
export type {
  Schema31To32MigrationReport,
  Schema31To32MigrationResult,
} from "./transforms/annotation-text-color.js";
export {
  upgradeSchema32To33,
  upgradeSchema32To33WithReport,
} from "./transforms/explicit-equivalence.js";
export type {
  Schema32To33MigrationReport,
  Schema32To33MigrationResult,
} from "./transforms/explicit-equivalence.js";
export {
  upgradeSchema33To34,
  upgradeSchema33To34WithReport,
} from "./transforms/net-name-provenance.js";
export type {
  Schema33To34MigrationReport,
  Schema33To34MigrationResult,
} from "./transforms/net-name-provenance.js";
export {
  upgradeSchema34To35,
  upgradeSchema34To35WithReport,
} from "./transforms/instance-reference.js";
export type {
  Schema34To35MigrationReport,
  Schema34To35MigrationResult,
} from "./transforms/instance-reference.js";
export {
  upgradeSchema35To36,
  upgradeSchema35To36WithReport,
} from "./transforms/instance-reference-annotation.js";

export type {
  Schema35To36MigrationReport,
  Schema35To36MigrationResult,
} from "./transforms/instance-reference-annotation.js";
