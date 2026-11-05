// Run with Node/tsx, outside Vitest's module transformer. This catches import
// cycles that pass typechecking, bundling and the ordinary integration suite.
import assert from 'node:assert/strict';
import { buildLocalServer } from '../apps/local-server/src/server.ts';
import { buildCloudApiServer } from '../apps/cloud-api/src/server.ts';

const local = await buildLocalServer({ dbPath: ':memory:', requireStrictAuth: true });
const cloud = await buildCloudApiServer({ dbPath: ':memory:', syncSecret: 'runtime-test-only-key' });
try {
  assert.equal((await local.app.inject('/api/health')).statusCode, 200);
  assert.equal((await cloud.app.inject('/api/health')).statusCode, 200);
  assert.equal(local.store.listHotelRooms().length, 24);
  assert.deepEqual(local.store.db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('Runtime Node: APIs iniciadas; 24 quartos; integridade referencial OK.');
} finally {
  await local.app.close();
  await cloud.app.close();
  cloud.closeDb();
}
