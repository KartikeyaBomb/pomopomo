// Run against the local production preview: node tests/history-api.mjs
import assert from 'node:assert/strict';
const base = process.env.POMO_TEST_URL ?? 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('This test only writes to a local test server.');
const user = `history-test-${Date.now()}`;
const headers = { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@test.local`, 'Content-Type': 'application/json' };
const request = (path, method = 'GET', data, identity = headers) => fetch(base + path, { method, headers: identity, body: data ? JSON.stringify(data) : undefined });
const start = Date.parse('2026-10-01T05:00:00Z'), end = Date.parse('2026-11-01T05:00:00Z');
const path = `/api/history?start=${start}&end=${end}`;
const entry = (completedAt, mode = 'focus', taskId = 'a') => ({ id: `${mode}:${taskId}:${completedAt}`, mode, taskId, taskName: 'Historical task', completedAt, durationSeconds: mode === 'focus' ? 1500 : 300 });
assert.equal((await request(path, 'GET', undefined, {})).status, 401);
assert.equal((await request('/api/history', 'POST', { entries: [entry(start)] }, {})).status, 401);
const records = [entry(start), entry(start + 1500000), entry(start + 1800000, 'break'), entry(end)];
assert.equal((await request('/api/history', 'POST', { entries: records })).status, 200);
assert.equal((await request('/api/history', 'POST', { entries: records })).status, 200);
let result = await (await request(path)).json();
assert.equal(result.entries.length, 3);
assert.equal(result.entries[0].mode, 'break');
assert.equal(result.entries.at(-1).completedAt, start);
assert.equal((await (await request(path, 'GET', undefined, { ...headers, 'oai-authenticated-user-id': user + '-other' })).json()).entries.length, 0);
// Same identity in another device/request sees the same history.
assert.deepEqual((await (await fetch(base + path, { headers: { ...headers } })).json()).entries, result.entries);
// Task edits and deletion cannot modify or erase the separate history ledger.
const state = { tasks: [{ id: 'a', name: 'Renamed task', estimate: 4, done: 2, color: '#e99573' }], timer: { taskId: null, mode: 'focus', remaining: 1500, deadline: null } };
let saved = await (await request('/api/state', 'PUT', { state, revision: 0 })).json();
assert.equal((await request('/api/state', 'PUT', { state: { ...state, tasks: [] }, revision: saved.revision })).status, 200);
result = await (await request(path)).json();
assert.equal(result.entries.length, 3);assert.ok(result.entries.every(item => item.taskName === 'Historical task'));
assert.equal((await request('/api/history', 'POST', { entries: [{ ...records[0], taskName: 'Overwrite attempt' }] })).status, 200);
assert.ok((await (await request(path)).json()).entries.every(item => item.taskName === 'Historical task'));
assert.equal((await request('/api/history', 'POST', { entries: [{ ...records[0], durationSeconds: -1 }] })).status, 400);
assert.equal((await request('/api/history', 'POST', { entries: [entry(Date.now() + 3600000)] })).status, 400);
assert.equal((await request('/api/history?start=0&end=999999999999')).status, 400);
assert.equal((await request('/api/history', 'POST', { entries: [records[0]] }, { ...headers, origin: 'https://unrelated.test' })).status, 403);
const batch = Array.from({ length: 50 }, (_, i) => entry(start + 2000000 + i, 'focus', 'batch'));
assert.equal((await request('/api/history', 'POST', { entries: batch })).status, 200);
assert.equal((await (await request(path)).json()).entries.length, 53);
console.log('PASS: history persistence, duplicate retry, immutable snapshots, task deletion, account isolation, month boundaries, validation, origin checks, and 50-session batch.');
