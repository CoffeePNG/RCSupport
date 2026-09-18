const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ChannelType, PermissionFlagsBits: P, PermissionsBitField, OverwriteType } = require('discord.js');
const { migrateDatabase } = require('../dist/db/migrations');
const db = new DatabaseSync(':memory:');
migrateDatabase(db);
migrateDatabase(db);
after(() => db.close());
const connectPath = require.resolve('../dist/db/connect');
const repoPath = require.resolve('../dist/db/guildSettingsRepo');
const previousConnect = require.cache[connectPath];
const previousRepo = require.cache[repoPath];
require.cache[connectPath] = { exports: { db } };
delete require.cache[repoPath];
const repo = require(repoPath);
const { vaultCommand, setVaultCommand, vaultedName } = require('../dist/features/vault/commands');
if (previousConnect) require.cache[connectPath] = previousConnect;
else delete require.cache[connectPath];
if (previousRepo) require.cache[repoPath] = previousRepo;
else delete require.cache[repoPath];

let sequence = 0;
function setup() {
  const guildId = `vault-guild-${++sequence}`;
  const edits = [], replies = [];
  const target = { id: 'target', name: 'support', type: ChannelType.GuildText,
    isThread: () => false, edit: async options => { edits.push(options); } };
  const category = { id: 'category', type: ChannelType.GuildCategory };
  const channels = new Map([['target', target], ['category', category]]);
  const guild = { id: guildId, channels: { fetch: async id => channels.get(id) ?? null },
    members: { fetchMe: async () => ({ permissions: new PermissionsBitField(P.Administrator) }) } };
  const interaction = { guild, guildId, channelId: 'target', user: { id: 'admin' },
    memberPermissions: new PermissionsBitField(P.Administrator),
    options: { getChannel: name => name === 'category' ? category : null },
    reply: async value => replies.push(value), deferReply: async () => {},
    editReply: async value => replies.push(value) };
  return { guildId, edits, replies, target, category, channels, guild, interaction };
}

test('vault commands register administrator-only, guild-only permissions', () => {
  for (const command of [vaultCommand, setVaultCommand]) {
    const data = command.data.toJSON();
    assert.equal(data.default_member_permissions, String(P.Administrator));
    assert.equal(data.dm_permission, false);
  }
  assert.deepEqual(setVaultCommand.data.toJSON().options[0].channel_types, [ChannelType.GuildCategory]);
});

test('Manage Server alone and DMs cannot configure or vault channels', async () => {
  for (const command of [vaultCommand, setVaultCommand]) {
    for (const dm of [false, true]) {
      const s = setup();
      s.interaction.memberPermissions = new PermissionsBitField(P.ManageGuild);
      if (dm) s.interaction.guild = null;
      await command.execute(s.interaction);
      assert.match(s.replies[0].content, /Only server administrators/);
      assert.equal(repo.getGuildSettings(s.guildId).vaultCategoryId, null);
      assert.equal(s.edits.length, 0);
    }
  }
});

test('category configuration survives migrations, is per guild, and preserves settings', async () => {
  const s = setup();
  repo.setModLogChannel(s.guildId, 'logs');
  await setVaultCommand.execute(s.interaction);
  migrateDatabase(db);
  assert.equal(repo.getGuildSettings(s.guildId).vaultCategoryId, 'category');
  assert.equal(repo.getGuildSettings(s.guildId).modLogChannelId, 'logs');
  assert.equal(repo.getGuildSettings('unconfigured').vaultCategoryId, null);
  s.category.type = ChannelType.GuildText;
  await setVaultCommand.execute(s.interaction);
  assert.match(s.replies.at(-1), /Choose a category/);
});

test('vault atomically replaces all overrides without syncing category permissions', async () => {
  const s = setup();
  repo.setVaultCategory(s.guildId, s.category.id);
  s.target.permissionOverwrites = { cache: new Map([
    ['staff', { allow: P.ViewChannel }], ['member', { allow: P.ViewChannel }],
  ]) };
  await vaultCommand.execute(s.interaction);
  assert.equal(s.edits.length, 1);
  const edit = s.edits[0];
  assert.equal(edit.name, 'support-[Vaulted]');
  assert.equal(edit.parent, 'category');
  assert.equal(edit.lockPermissions, false);
  assert.deepEqual(edit.permissionOverwrites, [{ id: s.guildId, type: OverwriteType.Role,
    allow: [], deny: [P.ViewChannel] }]);
  assert.match(s.replies.at(-1), /Only server administrators/);
});

test('missing/deleted category, threads, categories, and non-admin bots never mutate channels', async () => {
  for (const condition of ['unset', 'deleted', 'thread', 'category', 'bot']) {
    const s = setup();
    if (condition !== 'unset') repo.setVaultCategory(s.guildId, 'category');
    if (condition === 'deleted') s.channels.delete('category');
    if (condition === 'thread') s.target.isThread = () => true;
    if (condition === 'category') s.target.type = ChannelType.GuildCategory;
    if (condition === 'bot') s.guild.members.fetchMe = async () => ({ permissions: new PermissionsBitField(P.ManageChannels) });
    await vaultCommand.execute(s.interaction);
    assert.equal(s.edits.length, 0, condition);
    assert.equal(s.replies.length, 1, condition);
  }
});

test('explicit channel selection works and re-vaulting keeps one tag within name limit', async () => {
  const s = setup();
  repo.setVaultCategory(s.guildId, 'category');
  s.interaction.channelId = 'some-other-channel';
  s.interaction.options.getChannel = () => ({ id: 'target' });
  s.target.name = 'support-[vaulted]';
  await vaultCommand.execute(s.interaction);
  assert.equal(s.edits[0].name, 'support-[Vaulted]');
  assert.equal(vaultedName('x'.repeat(100)).length, 100);
  assert.equal(vaultedName(vaultedName('x'.repeat(100))), vaultedName('x'.repeat(100)));
});

test('Discord edit failure produces no success response and does not retry with weaker permissions', async () => {
  const s = setup();
  repo.setVaultCategory(s.guildId, 'category');
  let calls = 0;
  s.target.edit = async () => { calls++; throw new Error('Category full'); };
  const original = console.error;
  console.error = () => {};
  try { await vaultCommand.execute(s.interaction); }
  finally { console.error = original; }
  assert.equal(calls, 1);
  assert.match(s.replies.at(-1), /Couldn't confirm/);
});
