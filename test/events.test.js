const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventDecoder } = require('../dist/features/bugReports/events');

test('SSE decoder handles fragmented events, reconnect ready, and heartbeats', () => {
  let calls = 0;
  const decoder = new EventDecoder(() => calls++);
  for (const char of 'event: ready\r\ndata: {}\r\n\r\n: heartbeat\n\nevent: report-filed\ndata: {}\n\n') decoder.feed(char);
  assert.equal(calls, 2);
  decoder.feed('event: unknown\ndata: {}\n\n');
  assert.equal(calls, 2);
  assert.throws(() => decoder.feed('x'.repeat(4097)), /Oversized/);
});
