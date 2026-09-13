const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planStatusTags, replaceStatusTag } = require('../dist/rcsupport/statusTags');
const keys = ['open', 'acknowledged', 'in_progress', 'resolved', 'wontfix'];
const old = () => keys.map((name, i) => ({ id: `s${i}`, name, moderated: i === 2, emoji: null }));
test('readable tag migration preserves IDs, moderation, custom tags and is idempotent', () => {
  const custom = { id: 'custom', name: 'World issue', moderated: true, emoji: { id: 'custom-emoji', name: null } };
  const result = planStatusTags([...old(), custom]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.tags.slice(0, 5).map(t => t.id), ['s0','s1','s2','s3','s4']);
  assert.deepEqual(result.tags.slice(0, 5).map(t => t.name), ['Open','Acknowledged','In Progress','Resolved','Won’t Fix']);
  assert.deepEqual(result.tags.slice(0, 5).map(t => t.emoji.name), ['🔴','👀','🔧','✅','⛔']);
  assert.equal(result.tags[2].moderated, true); assert.deepEqual(result.tags[5], custom);
  assert.equal(planStatusTags(result.tags).changed, false);
  assert.deepEqual(replaceStatusTag(result.tags, ['custom','s0'], 'resolved'), ['custom','s3']);
});
test('ambiguous old and new tags and a full Forum are rejected without deleting tags', () => {
  const tags = old(); tags.push({ ...tags[0], id: 'duplicate', name: 'Open' });
  assert.throws(() => planStatusTags(tags), /Ambiguous/); assert.equal(tags[0].name, 'open');
  assert.throws(() => planStatusTags(Array.from({length: 20}, (_, i) => ({id:String(i), name:`custom${i}`, moderated:false, emoji:null}))), /no room/);
  assert.throws(() => replaceStatusTag(old(), ['a','b','c','d','e'], 'resolved'), /five custom tags/);
});
