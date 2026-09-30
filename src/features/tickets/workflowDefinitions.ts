import { SlashCommandSubcommandBuilder } from 'discord.js';
const typeOption=(sub:SlashCommandSubcommandBuilder,required=false)=>sub.addStringOption(o=>o.setName('type').setDescription('Ticket type').setRequired(required).setAutocomplete(true));
export const workflowSubcommands=[
  typeOption(new SlashCommandSubcommandBuilder().setName('reassign').setDescription('Transfer this ticket to a team or staff member.'))
    .addUserOption(o=>o.setName('staff').setDescription('Destination lead or server manager'))
    .addStringOption(o=>o.setName('reason').setDescription('Reason for the transfer').setMaxLength(500)),
  typeOption(new SlashCommandSubcommandBuilder().setName('history').setDescription('Find tickets you are authorized to manage.'))
    .addUserOption(o=>o.setName('requester').setDescription('Filter by requester'))
    .addStringOption(o=>o.setName('status').setDescription('Filter by status').addChoices({name:'Open',value:'open'},{name:'Claimed',value:'claimed'},{name:'Closed',value:'closed'}))
    .addIntegerOption(o=>o.setName('page').setDescription('History page').setMinValue(1)),
  new SlashCommandSubcommandBuilder().setName('details').setDescription('View a ticket and recent workflow activity.')
    .addIntegerOption(o=>o.setName('id').setDescription('Ticket number').setMinValue(1).setRequired(true)),
  new SlashCommandSubcommandBuilder().setName('transcript').setDescription('Retrieve a closed ticket’s saved transcript privately.')
    .addIntegerOption(o=>o.setName('id').setDescription('Ticket number').setMinValue(1).setRequired(true)),
  new SlashCommandSubcommandBuilder().setName('waiting').setDescription('Set who this ticket is waiting on.')
    .addStringOption(o=>o.setName('on').setDescription('Who should respond next').setRequired(true).addChoices({name:'Staff',value:'staff'},{name:'Requester',value:'requester'},{name:'Nobody / clear',value:'none'})),
];
export const remindersSubcommand=typeOption(new SlashCommandSubcommandBuilder().setName('notifications').setDescription('View or configure in-ticket reminders; zero disables a timer.'),true)
  .addIntegerOption(o=>o.setName('unclaimed-minutes').setDescription('Minutes before one unclaimed reminder; 0 = off').setMinValue(0).setMaxValue(10080))
  .addIntegerOption(o=>o.setName('waiting-minutes').setDescription('Minutes before one waiting reminder; 0 = off').setMinValue(0).setMaxValue(10080));

