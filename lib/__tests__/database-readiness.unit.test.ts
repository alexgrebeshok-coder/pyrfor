import assert from "node:assert/strict";

import {
  DATABASE_CONNECTION_UNAVAILABLE_MESSAGE,
  DATABASE_SCHEMA_UNAVAILABLE_MESSAGE,
  getDatabaseReadinessErrorMessage,
  isDatabaseConnectionError,
  isPrismaSchemaMissingError,
  probeDatabaseReadiness,
} from "@/lib/server/database-readiness";

async function testProbePassesWhenSchemaQuerySucceeds() {
  const result = await probeDatabaseReadiness(async () => null);

  assert.deepEqual(result, {
    status: "connected",
  });
}

async function testProbeClassifiesMissingTableErrors() {
  const missingTableError = Object.assign(new Error("The table `main.Project` does not exist."), {
    code: "P2021",
  });

  const result = await probeDatabaseReadiness(async () => {
    throw missingTableError;
  });

  assert.equal(isPrismaSchemaMissingError(missingTableError), true);
  assert.equal(result.status, "error");
  assert.equal(result.message, DATABASE_SCHEMA_UNAVAILABLE_MESSAGE);
}

async function testProbeKeepsGenericDatabaseErrorsReadable() {
  const genericError = new Error("Connection timeout");

  const result = await probeDatabaseReadiness(async () => {
    throw genericError;
  });

  assert.equal(isPrismaSchemaMissingError(genericError), false);
  assert.equal(getDatabaseReadinessErrorMessage(genericError), "Connection timeout");
  assert.equal(result.status, "error");
  assert.equal(result.message, "Connection timeout");
}

async function testProbeClassifiesDatabaseConnectionErrors() {
  const connectionError = new Error("Unable to open the database file");

  const result = await probeDatabaseReadiness(async () => {
    throw connectionError;
  });

  assert.equal(isDatabaseConnectionError(connectionError), true);
  assert.equal(result.status, "error");
  assert.equal(result.message, DATABASE_CONNECTION_UNAVAILABLE_MESSAGE);
}

async function main() {
  await testProbePassesWhenSchemaQuerySucceeds();
  await testProbeClassifiesMissingTableErrors();
  await testProbeKeepsGenericDatabaseErrorsReadable();
  await testProbeClassifiesDatabaseConnectionErrors();
  console.log("PASS database-readiness.unit");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
