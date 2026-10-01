import { EmbedBuilder } from "discord.js";
import { departments, positions, positionLabel, AssignmentInput } from "./hierarchy";
import { Assignment, Vacancy } from "./repository";
const defaultRosterRoleIds:Record<string,string>={
  "moderation-administrator":"1555045039691014184",
  "developer":"1470587929066864660",
  "helper":"1470587896774918236",
  "senior-builder":"1476401943747498080",
  "builder":"1470588490214543513",
  "trial-builder":"1470593742078611698",

  "senior-moderator":"1269507769946607616",
  "moderator":"1269507771766804562",
  "junior-moderator":"1470589267465076914",

  "project-coordinator":"1513640023252013136",
  "modeler-administrator":"1552134126818041917",

  "director":"1470588590215135273",
  "general-manager":"1470587234175680512",
  "gameplay-administrator":"1269507765521616998",
  "build-administrator":"1552134109088718918",
  "developer-administrator":"1552134119717081108",
  "public-relations-administrator":"1552134326953713756",
  "support-administrator":"1552134357920120842",

  "engineering-manager":"1470587167221878917",
  "community-manager":"1470587167221878917",
};

export function assignmentLabel(row: AssignmentInput): string {
  const position=positions.find(position => position.id === row.position);
  return `${position ? positionLabel(position) : row.position}${row.senior ? " (Senior)" : ""}${row.designation ? ` [${row.designation}]` : ""}`;
}
/** Plain branches with nonbreaking indentation; no code styling or vertical connectors. */
export function renderRoster(assignments: Assignment[], vacancies: Vacancy[], roleIds:Record<string,string>={}): string[] {
  const roles={...defaultRosterRoleIds,...roleIds};
  const rosterPositionTitle=(position:typeof positions[number]) => roles[position.id] ? `<@&${roles[position.id]}>` : position.title;
  const lines=["**RepubliCraft Staff Roster**",""];
  for (const department of departments) {
    lines.push(`**${department === "Shared Support" ? "Helpers" : department === "Management" ? "Executive" : department}${["Engineering","Community"].includes(department) ? " Department" : ""}**`);
    interface Entry { title:string; children?:Entry[]; }
    const entries: Entry[]=[];
    const departmentPositions=positions.filter(position => position.department === department);
    const rowsFor=(id:string) => {
      const position=positions.find(position => position.id === id)!;
      const rows=[...assignments.filter(row => row.position === id),...vacancies.filter(row => row.position === id)]
        .sort((a,b) => Number(b.senior)-Number(a.senior) || a.id.localeCompare(b.id));
      return rows.map(row => `${row.senior ? "★ " : ""}${rosterPositionTitle(position)}${row.designation ? ` [${row.designation}]` : ""} • ${"user_id" in row ? `<@${row.user_id}>` : "*Vacant*"}`);
    };
    const manager=departmentPositions.find(position => position.id === "engineering-manager" || position.id === "community-manager");
    for (const position of departmentPositions.filter(position => !position.team && position !== manager)) {
      for (const title of rowsFor(position.id)) entries.push({title});
    }
    for (const team of new Set(departmentPositions.map(position => position.team).filter(Boolean))) {
      const teamPositions=departmentPositions.filter(position => position.team === team);
      const administrators=teamPositions.filter(position => position.seniority).flatMap(position => rowsFor(position.id));
      const ranks=teamPositions.filter(position => !position.seniority).flatMap(position => rowsFor(position.id)).map(title => ({title}));
      const children:Entry[]=[];
      if (ranks.length) {
        // A shared role heading avoids implying that only the last administrator supervises the team.
        children.push(administrators.length === 1
          ? {title:administrators[0],children:ranks}
          : {title:rosterPositionTitle(teamPositions.find(position => position.seniority)!),children:[...administrators.map(title => ({title})),...ranks]});
      } else children.push(...administrators.map(title => ({title})));
      entries.push({title:`**${team}**`,children:children.length ? children : [{title:"*No assignments or vacancies recorded*"}]});
    }
    if (!entries.length) entries.push({title:"*No assignments or vacancies recorded*"});
    const renderEntries=(items:Entry[],prefix="") => items.forEach((entry,i) => {
      const last=i === items.length-1;
      lines.push(`${prefix}${last ? "└" : "├"} ${entry.title}`);
      if (entry.children) renderEntries(entry.children,`${prefix}\u2003\u2003`);
    });
    if (manager) {
      const managers=rowsFor(manager.id);
      // A structural heading keeps teams nested even before a manager is recorded.
      const root:Entry=managers.length === 1
        ? {title:managers[0],children:entries}
        : {title:rosterPositionTitle(manager),children:[...managers.map(title => ({title})),...entries]};
      renderEntries([root]);
    } else renderEntries(entries);
    lines.push("");
  }
  const pages:string[]=[];let page="";
  for (const line of lines) {
    if ((page+line+"\n").length > 1900) {pages.push(page.trimEnd());page="**Staff Roster — continued**\n";}
    page+=line+"\n";
  }
  if (page.trim()) pages.push(page.trimEnd());
  return pages;
}

/** Match the Server Information panel; each existing roster page fits one embed. */
export function rosterEmbed(page:string):EmbedBuilder {
  const [heading,...body]=page.split("\n");
  return new EmbedBuilder().setColor(0xbd63aa)
    .setFooter({text:"★ Senior Administrator"})
    .setTitle(heading.replace(/^\*\*|\*\*$/g,""))
    .setDescription(body.join("\n").replace(/^\n+|\n+$/g,""));
}
