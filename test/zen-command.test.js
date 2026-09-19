const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const service = require('../dist/services/zen');
const { zenCommand } = require('../dist/features/moderation/commands/zen');

test('zen requires duration and posts exact public announcement after finishing private acknowledgment', async () => {
  assert.equal(zenCommand.data.toJSON().options[0].required, true);
  const previous = service.getZen;
  const calls = [];
  service.getZen = () => ({ lock: async (_, duration) => { assert.equal(duration, 600000); return 1200000; } });
  try {
    await zenCommand.execute({ guild: {}, channel: { type: ChannelType.GuildText },
      memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
      appPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
      options: { getString: () => '10m' },
      deferReply: async () => calls.push('defer'),
      editReply: async () => calls.push('edit'),
      followUp: async payload => { calls.push('public'); assert.equal(payload.flags, undefined); assert.match(payload.content, /^Everyone must enter\.{11}the chill zone :snowflake:/); },
    });
    assert.deepEqual(calls, ['defer', 'edit', 'public']);
  } finally { service.getZen = previous; }
});
