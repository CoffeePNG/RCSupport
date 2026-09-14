const { test } = require('node:test');
const assert = require('node:assert/strict');

// Substitute leaf handlers only: run the real central and feature dispatchers.
const replacements = {
  '../dist/features/tickets/ticketHandler': {},
  '../dist/features/tickets/configHandler': {CONFIG_EDIT_MODAL_PREFIX:'ticket_config_edit:',PANEL_EDIT_MODAL_ID:'ticket_panel_edit'},
  '../dist/features/todo/todoHandler': {},
  '../dist/features/bugReports/panel': {},
  '../dist/features/bugReports/commands/bugreport': {BUGTHREAD_BUTTON_ID:'rcsupport:open',BUGTHREAD_MODAL_ID:'rcsupport:submit'},
};
const routes = [
  ['modal','rcsupport:submit','submitBugModal','bugReports/panel'],
  ['button','rcsupport:open','openBugModal','bugReports/panel'],
  ['modal','ticket_create_modal:bug','handleTicketCreateModal','tickets/ticketHandler'],
  ['modal','ticket_config_edit:1','handleConfigEditModalSubmit','tickets/configHandler'],
  ['modal','ticket_panel_edit','handlePanelEditModalSubmit','tickets/configHandler'],
  ['select','ticket_panel_select','handleTicketPanelSelect','tickets/ticketHandler'],
  ['button','ticket_close_confirm:1','handleTicketCloseConfirm','tickets/ticketHandler'],
  ['button','ticket_close_cancel:1','handleTicketCloseCancel','tickets/ticketHandler'],
  ['button','ticket_close:1','handleTicketCloseRequest','tickets/ticketHandler'],
  ['button','ticket_claim:1','handleTicketClaim','tickets/ticketHandler'],
  ['modal','todo_add_modal','handleTodoAddModalSubmit','todo/todoHandler'],
  ['select','todo_complete_select','handleTodoCompleteSelect','todo/todoHandler'],
  ['select','todo_remove_select','handleTodoRemoveSelect','todo/todoHandler'],
  ['select','todo_assign_select','handleTodoAssignSelect','todo/todoHandler'],
  ['user','todo_assign_user:1','handleTodoAssignUserSelect','todo/todoHandler'],
  ['button','todo_add','handleTodoAddButton','todo/todoHandler'],
  ['button','todo_complete','handleTodoCompleteButton','todo/todoHandler'],
  ['button','todo_remove','handleTodoRemoveButton','todo/todoHandler'],
  ['button','todo_assign','handleTodoAssignButton','todo/todoHandler'],
  ['button','todo_unassign:1','handleTodoUnassignButton','todo/todoHandler'],
];
let calls = [], fail = false;
for (const [, , name, module] of routes) replacements['../dist/features/'+module][name] = async () => {
  calls.push(name); if (fail) throw new Error('leaf failed');
};
const saved = new Map();
for (const [path,exports] of Object.entries(replacements)) {
  const id=require.resolve(path);saved.set(id,require.cache[id]);require.cache[id]={exports};
}
const {handleInteraction} = require('../dist/events/interactionCreate');
for(const [id,previous] of saved) { if(previous) require.cache[id]=previous; else delete require.cache[id]; }
function interaction(type,customId) {
  return {customId,guildId:'allowed',commandName:'test',replied:false,deferred:false,
    isChatInputCommand:()=>type==='command',isAutocomplete:()=>type==='autocomplete',
    isModalSubmit:()=>type==='modal',isButton:()=>type==='button',
    isStringSelectMenu:()=>type==='select',isUserSelectMenu:()=>type==='user',
    isRepliable:()=>true,reply:async()=>{calls.push('reply');}};
}
test('all existing component IDs route to exactly one handler; unknown IDs remain ignored', async()=>{
  for(const [type,id,handler] of routes){
    calls=[];await handleInteraction(interaction(type,id),new Map(),{});
    assert.deepEqual(calls,[handler],id);
  }
  calls=[];await handleInteraction(interaction('button','unknown'),new Map(),{});assert.deepEqual(calls,[]);
  await handleInteraction(interaction('button','rcsupport:open'),new Map());assert.deepEqual(calls,[]);
});
test('command scope, autocomplete and the shared error boundary survive dispatch extraction',async()=>{
  const command={guildIds:['allowed'],execute:async()=>{calls.push('command');},autocomplete:async()=>{calls.push('autocomplete');}};
  const commands=new Map([['test',command]]);
  calls=[];await handleInteraction({...interaction('command'),guildId:'elsewhere'},commands);assert.deepEqual(calls,['reply']);
  calls=[];await handleInteraction(interaction('command'),commands);assert.deepEqual(calls,['command']);
  calls=[];await handleInteraction(interaction('autocomplete'),commands);assert.deepEqual(calls,['autocomplete']);
  const log=console.error;console.error=()=>{};fail=true;
  try {
    calls=[];await handleInteraction(interaction('button','ticket_close:1'),commands);assert.deepEqual(calls,['handleTicketCloseRequest','reply']);
    calls=[];await handleInteraction({...interaction('button','ticket_close:1'),deferred:true},commands);assert.deepEqual(calls,['handleTicketCloseRequest']);
  } finally {fail=false;console.error=log;}
});
