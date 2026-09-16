const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fs = require('node:fs');
// Load the real command and modal handlers without database-dependent admin deletion.
const commandPath = require.resolve('../dist/features/bugReports/commands/bugreport');
const panelPath = require.resolve('../dist/features/bugReports/panel');
function load(file, overrides) {
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  const original = mod.require.bind(mod);
  mod.require = id => Object.hasOwn(overrides, id) ? overrides[id] : original(id);
  mod._compile(fs.readFileSync(file, 'utf8'), file);
  return mod.exports;
}
const panel = load(panelPath, {'./commands/bugreport': {BUGTHREAD_MODAL_ID:'rcsupport:submit'}});
const commands = load(commandPath, {'../panel': panel, '../deleteThread': {}});
function fixture(values = {}, allowed = true) {
  const calls = {};
  return { calls, forum: {
    getForum: () => ({guildId:'guild', permissionsFor:()=>({has:()=>allowed})}),
    createNativePost: async (...args) => { calls.post = args; return {id:'report'}; },
  }, interaction: {
    guildId:'guild', user:{id:'user'},
    fields:{fields:new Map(Object.entries(values)), getTextInputValue:id=>values[id], getStringSelectValues:id=>values[id]},
    showModal:async modal=>{calls.modal=modal.toJSON();},
    reply:async data=>{calls.reply=data;}, deferReply:async data=>{calls.defer=data;},
    editReply:async data=>{calls.result=data;},
  }};
}
test('bare /bugreport opens five fields; admin operations remain on /br', async()=>{
  const data=commands.bugreportCommand.data.toJSON();
  assert.equal(data.name,'bugreport'); assert.equal(data.options.length,0);
  assert.equal(data.default_member_permissions,undefined);
  assert.deepEqual(commands.brCommand.data.toJSON().options.map(o=>o.name),['setup','delete','refresh']);
  const f=fixture(); await commands.bugreportCommand.execute(f.interaction,f.forum);
  assert.equal(f.calls.modal.components.length,5);
  const components=f.calls.modal.components.map(label=>label.component);
  assert.deepEqual(components[0].options.map(o=>o.value),['Gameplay','World / Building','Permissions','Other']);
  assert.deepEqual(components.slice(1).map(c=>[c.custom_id,c.required,c.max_length]),
    [['summary',true,100],['description',true,2000],['steps',false,1000],['evidence',false,500]]);
});
test('maximum answers survive submission and stay below native embed limit', async()=>{
  const values={category:['World / Building'],summary:'s'.repeat(100), description:'d'.repeat(2000), steps:'r'.repeat(1000), evidence:'https://example.com/'+ 'u'.repeat(480)};
  const f=fixture(values); await panel.submitBugModal(f.interaction,f.forum);
  for (const value of Object.values(values)) assert.ok(f.calls.post[0].includes(Array.isArray(value)?value[0]:value));
  assert.ok(f.calls.post[0].length<=4000);
  assert.equal(f.calls.defer.flags,64); assert.ok(f.calls.result.content.includes('<#report>'));
});
test('access denial and whitespace-only required answers cannot create reports', async()=>{
  const denied=fixture({},false); await panel.openBugModal(denied.interaction,denied.forum);
  await panel.submitBugModal(denied.interaction,denied.forum);
  assert.ok(denied.calls.reply); assert.equal(denied.calls.modal,undefined); assert.equal(denied.calls.post,undefined);
  const empty=fixture({summary:'   ',description:'details',steps:'steps',expected:'expected'});
  await panel.submitBugModal(empty.interaction,empty.forum); assert.equal(empty.calls.post,undefined);
});
test('previously opened description-only forms still submit', async()=>{
  const f=fixture({description:'Legacy report'});await panel.submitBugModal(f.interaction,f.forum);
  assert.deepEqual(f.calls.post,['Legacy report','user']);
});

test('in-game required fields suffice; unknown categories and invalid links are rejected', async()=>{
  const values={category:['Gameplay'],summary:'X',description:'Y'};
  const f=fixture(values); await panel.submitBugModal(f.interaction,f.forum);
  assert.ok(f.calls.post[0].includes('Gameplay'));
  for (const invalid of [{...values,category:['Unknown']},{...values,evidence:'javascript:alert(1)'}, {...values,evidence:'https://user:password@example.com/'}]) {
    const f=fixture(invalid);await panel.submitBugModal(f.interaction,f.forum);
    assert.equal(f.calls.post,undefined);assert.ok(f.calls.reply);
  }
});
