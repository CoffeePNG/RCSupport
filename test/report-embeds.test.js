const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reportEmbedBatches } = require('../dist/features/bugReports/reportEmbeds');
const base = { id: 42, reporter_name: 'Builder', discord_id: '123', server_id: 'build1', description: 'Broken door' };

test('maximum wizard fields are preserved and fit one Discord message', () => {
  const ticket = { ...base, title: 't'.repeat(100), category: 'c'.repeat(50), description: 'd'.repeat(2000),
    reproduction_steps: 's'.repeat(1000), item_attachment: 'i'.repeat(1000), url_attachment: 'u'.repeat(500) };
  const batches = reportEmbedBatches(ticket);
  assert.equal(batches.length, 1);
  const fields = batches[0][0].toJSON().fields;
  for (const [label, key] of [['Title','title'], ['Description','description'], ['Reproduction steps','reproduction_steps'], ['Attached item','item_attachment'], ['Screenshot / video link','url_attachment']]) {
    assert.equal(fields.filter(f => f.name.startsWith(label)).map(f => f.value).join(''), ticket[key]);
  }
  assert.ok(fields.some(f => f.name === 'Reporter' && f.value.includes('Builder')));
  assert.ok(fields.every(f => f.value.length <= 1024));
});

test('legacy and omitted optional fields render; oversized legacy text is never cut', () => {
  const ticket = { ...base, description: '😀'.repeat(9000) };
  const batches = reportEmbedBatches(ticket);
  const fields = batches.flatMap(b => b.flatMap(e => e.toJSON().fields));
  assert.equal(fields.filter(f => f.name.startsWith('Description')).map(f => f.value).join(''), ticket.description);
  for (const batch of batches) {
    assert.ok(batch.reduce((n, e) => n + e.length, 0) <= 6000);
    assert.ok(batch.every(e => e.toJSON().fields.length <= 25));
  }
  assert.ok(fields.some(f => f.value === 'Other (legacy report)'));
});
