import { EmbedBuilder } from "discord.js";
import { departments, positions, positionLabel, AssignmentInput } from "./hierarchy";
import { Assignment, Vacancy } from "./repository";
export function assignmentLabel(row: AssignmentInput): string {
  const position=positions.find(position => position.id === row.position);
  return `${position ? positionLabel(position) : row.position}${row.senior ? " (Senior)" : ""}${row.designation ? ` [${row.designation}]` : ""}`;
}
/** Monospace only tree prefixes: preserve alignment without putting mentions in code. */
export function renderRoster(assignments: Assignment[], vacancies: Vacancy[]): string[] {
  const lines=["**RepubliCraft Staff Roster**",""];
  for (const department of departments) {
    lines.push(`**${department}${["Engineering","Community"].includes(department) ? " Department" : ""}**`);
    interface Entry { title:string; children?:Entry[]; }
    const entries: Entry[]=[];
    const departmentPositions=positions.filter(position => position.department === department);
    const rowsFor=(id:string) => {
      const position=positions.find(position => position.id === id)!;
      const rows=[...assignments.filter(row => row.position === id),...vacancies.filter(row => row.position === id)]
        .sort((a,b) => Number(b.senior)-Number(a.senior) || a.id.localeCompare(b.id));
      return rows.map(row => `${row.senior ? "Sr. " : ""}${position.title}${row.designation ? ` [${row.designation}]` : ""} • ${"user_id" in row ? `<@${row.user_id}>` : "*Vacant*"}`);
    };
    for (const position of departmentPositions.filter(position => !position.team)) {
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
          : {title:"Administrator",children:[...administrators.map(title => ({title})),...ranks]});
      } else children.push(...administrators.map(title => ({title})));
      entries.push({title:`**${team}**`,children:children.length ? children : [{title:"*No assignments or vacancies recorded*"}]});
    }
    if (!entries.length) entries.push({title:"*No assignments or vacancies recorded*"});
    const renderEntries=(items:Entry[],prefix="") => items.forEach((entry,i) => {
      const last=i === items.length-1;
      lines.push(`\`${prefix}${last ? "└" : "├"}\` ${entry.title}`);
      if (entry.children) renderEntries(entry.children,`${prefix}${last ? "    " : "│   "}`);
    });
    renderEntries(entries);
    if (department === "Shared Support") lines.push("*Helpers support Gameplay, Public Relations, and Support.*");
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
    .setTitle(heading.replace(/^\*\*|\*\*$/g,""))
    .setDescription(body.join("\n").trim());
}
