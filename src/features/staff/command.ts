import { ActionRowBuilder, AutocompleteInteraction, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelType, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder, SlashCommandSubcommandBuilder } from "discord.js";
import { Command } from "../../commands/types";
import { staffModule } from "../../modules/catalog";
import { AssignmentInput, positions, positionLabel } from "./hierarchy";
import { assignmentLabel, renderRoster, rosterEmbed } from "./renderer";
import { StaffActor } from "./service";
import { Capability } from "./settings";

function positionOptions(sub:SlashCommandSubcommandBuilder) {
  return sub.addStringOption(option => option.setName("position").setDescription("Choose a department/team position.").setRequired(true).setAutocomplete(true))
    .addBooleanOption(option => option.setName("senior").setDescription("Administrator seniority only; Sr. Moderator is a separate position."))
    .addStringOption(option => option.setName("designation").setDescription("Optional designation such as E or GT.").setMaxLength(16));
}
const data=new SlashCommandBuilder().setName("staff").setDescription("Manage organizational staff assignments and the roster.").setDMPermission(false)
  .addSubcommand(sub => positionOptions(sub.setName("hire").setDescription("Hire a new or returning staff member.").addUserOption(option => option.setName("user").setDescription("Staff member").setRequired(true))))
  .addSubcommand(sub => positionOptions(sub.setName("assign").setDescription("Give an active staff member another assignment.").addUserOption(option => option.setName("user").setDescription("Staff member").setRequired(true))))
  .addSubcommand(sub => sub.setName("remove").setDescription("End one assignment, retaining history.")
    .addUserOption(option => option.setName("user").setDescription("Staff member").setRequired(true))
    .addStringOption(option => option.setName("assignment").setDescription("Current assignment").setRequired(true).setAutocomplete(true)))
  .addSubcommand(sub => sub.setName("fire").setDescription("Review and confirm removal from all staff assignments.")
    .addUserOption(option => option.setName("user").setDescription("Staff member").setRequired(true)))
  .addSubcommandGroup(group => group.setName("vacancy").setDescription("Manage stored vacancies.")
    .addSubcommand(sub => positionOptions(sub.setName("create").setDescription("Record a vacant position.")))
    .addSubcommand(sub => sub.setName("remove").setDescription("Close a vacancy.").addStringOption(option => option.setName("vacancy").setDescription("Open vacancy").setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName("fill").setDescription("Fill a vacancy, hiring the person if needed.")
      .addStringOption(option => option.setName("vacancy").setDescription("Open vacancy").setRequired(true).setAutocomplete(true))
      .addUserOption(option => option.setName("user").setDescription("Person to fill this vacancy").setRequired(true))))
  .addSubcommandGroup(group => group.setName("roster").setDescription("View or publish the staff roster.")
    .addSubcommand(sub => sub.setName("view").setDescription("Preview the current roster privately."))
    .addSubcommand(sub => sub.setName("refresh").setDescription("Retry Discord roles and refresh the published roster."))
    .addSubcommand(sub => sub.setName("publish").setDescription("Publish the managed roster in this server.")
      .addChannelOption(option => option.setName("channel").setDescription("Roster channel").setRequired(true).addChannelTypes(ChannelType.GuildText))));

export function staffActor(interaction:ChatInputCommandInteraction|AutocompleteInteraction|ButtonInteraction,source:string):StaffActor {
  const roles=interaction.member?.roles;
  return {userId:interaction.user.id,guildId:interaction.guildId,permissions:interaction.memberPermissions?.bitfield ?? 0n,
    roleIds:Array.isArray(roles) ? roles : roles ? [...roles.cache.keys()] : [],source};
}
const input=(interaction:ChatInputCommandInteraction):AssignmentInput => ({position:interaction.options.getString("position",true),senior:interaction.options.getBoolean("senior") ?? false,designation:interaction.options.getString("designation") ?? ""});
const runtimeFor=async(interaction:{client:ChatInputCommandInteraction["client"]}) => (await import("./runtime")).getStaffRuntime(interaction.client);
const syncResult=async(runtime:Awaited<ReturnType<typeof runtimeFor>>) => {
  try {await runtime.sync.sync();} catch(error) {console.error("Staff synchronization failed:",error);}
  return runtime.service.repo.syncState()?.pending ? "Saved. Discord updates are pending and will retry automatically; use /staff roster refresh to retry now." : "Saved. Discord synchronization completed.";
};
function capability(group:string|null,sub:string):Capability {
  return group === "vacancy" ? "vacancy" : group === "roster" ? sub === "view" ? "view" : "roster" : sub as Capability;
}
export const staffCommand:Command = {
  module:staffModule,data,
  async autocomplete(interaction) {
    try {
      const runtime=await runtimeFor(interaction),actor=staffActor(interaction,"/staff autocomplete");
      const group=interaction.options.getSubcommandGroup(false),sub=interaction.options.getSubcommand();
      if (!runtime.service.allowed(actor,capability(group,sub)) || (group === "vacancy" && sub === "fill" && !runtime.service.allowed(actor,"assign") && !runtime.service.allowed(actor,"hire"))) {await interaction.respond([]);return;}
      const focused=interaction.options.getFocused(true),query=String(focused.value).toLowerCase();
      let choices:{name:string;value:string}[]=[];
      if (focused.name === "position") choices=positions.map(position => ({name:positionLabel(position),value:position.id}));
      if (focused.name === "assignment") {
        const user=interaction.options.get("user")?.value;
        if (typeof user === "string") choices=runtime.service.repo.assignments(user).map(row => ({name:assignmentLabel(row),value:row.id}));
      }
      if (focused.name === "vacancy") choices=runtime.service.repo.vacancies().map(row => ({name:`${assignmentLabel(row)} · ${row.id.slice(0,6)}`,value:row.id}));
      await interaction.respond(choices.filter(choice => choice.name.toLowerCase().includes(query)).slice(0,25).map(choice => ({...choice,name:choice.name.slice(0,100)})));
    } catch(error) {console.error("Staff autocomplete failed:",error);if (!interaction.responded) await interaction.respond([]);}
  },
  async execute(interaction) {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    try {
      const runtime=await runtimeFor(interaction),service=runtime.service;
      const group=interaction.options.getSubcommandGroup(false),sub=interaction.options.getSubcommand();
      const actor=staffActor(interaction,`/staff ${group ? group+" " : ""}${sub}`);
      service.authorize(actor,capability(group,sub));
      if (group === "roster" && sub === "view") {
        const pages=renderRoster(service.repo.assignments(),service.repo.vacancies(),service.settings.rosterRoleIds);
        await interaction.editReply({embeds:[rosterEmbed(pages[0])],allowedMentions:{parse:[]}});
        for (const content of pages.slice(1)) await interaction.followUp({embeds:[rosterEmbed(content)],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
        return;
      }
      if (group === "roster") {
        if (sub === "publish") {
          const channel=interaction.options.getChannel("channel",true);
          if (channel.type !== ChannelType.GuildText) throw new Error("Choose a text channel in this server.");
          service.publish(actor,channel.id);
        } else service.repo.queue();
      } else if (group === "vacancy") {
        if (sub === "create") service.vacancy(actor,"create",input(interaction));
        else service.vacancy(actor,sub as "fill"|"remove",undefined,interaction.options.getString("vacancy",true),interaction.options.getUser("user")?.id);
      } else {
        const user=interaction.options.getUser("user",true);
        if (sub === "hire" || sub === "assign") service.add(actor,sub,user.id,input(interaction));
        else if (sub === "remove") service.remove(actor,user.id,interaction.options.getString("assignment",true));
        else if (sub === "fire") {
          const request=service.requestFire(actor,user.id);
          const lines=request.assignments.map(row => `• ${assignmentLabel(row)}`);
          const chunks:string[]=[];let chunk=`Remove <@${user.id}> from staff? All of these assignments will end:\n`;
          for (const line of lines.length ? lines : ["No current assignments."]) {
            if (chunk.length+line.length>1850) {chunks.push(chunk);chunk="";}
            chunk+=line+"\n";
          }
          chunks.push(chunk);
          await interaction.editReply({content:chunks[0],allowedMentions:{parse:[]}});
          for (const content of chunks.slice(1)) await interaction.followUp({embeds:[rosterEmbed(content)],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
          const buttons=new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`staff:fire:confirm:${request.id}`).setLabel("Confirm removal").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`staff:fire:cancel:${request.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary));
          await interaction.followUp({content:"This confirmation expires in five minutes. History will be retained.",components:[buttons],flags:MessageFlags.Ephemeral});return;
        }
      }
      await interaction.editReply(await syncResult(runtime));
    } catch(error) {
      console.error("Staff action failed:",error);
      await interaction.editReply({content:(error as Error).message.slice(0,1900),allowedMentions:{parse:[]}});
    }
  }
};
export async function handleStaffConfirmation(interaction:ButtonInteraction) {
  await interaction.deferUpdate();
  try {
    const runtime=await runtimeFor(interaction),cancel=interaction.customId.startsWith("staff:fire:cancel:");
    const actor=staffActor(interaction,cancel ? "staff:fire:cancel" : "staff:fire:confirm");
    runtime.service.confirmFire(actor,interaction.customId.split(":").pop()!,cancel);
    await interaction.editReply({content:cancel ? "Cancelled. No assignments changed." : await syncResult(runtime),components:[]});
  } catch(error) {
    await interaction.followUp({content:(error as Error).message.slice(0,1900),flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  }
}
