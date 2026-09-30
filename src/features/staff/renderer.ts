import { departments, positions, positionLabel, AssignmentInput } from "./hierarchy";
import { Assignment, Vacancy } from "./repository";
export function assignmentLabel(row: AssignmentInput): string {
  const position=positions.find(position => position.id === row.position);
  return `${position ? positionLabel(position) : row.position}${row.senior ? " (Senior)" : ""}${row.designation ? ` [${row.designation}]` : ""}`;
}
/** Stable plain Markdown with tree characters; no code block so mentions render. */
export function renderRoster(assignments: Assignment[], vacancies: Vacancy[]): string[] {
  const lines=["**RepubliCraft Staff Roster**",""];
  for (const department of departments) {
    lines.push(`**${department}${["Engineering","Community"].includes(department) ? " Department" : ""}**`);
    const entries: {title:string;children?:string[]}[]=[];
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
      const children=departmentPositions.filter(position => position.team === team).flatMap(position => rowsFor(position.id));
      entries.push({title:`**${team}**`,children:children.length ? children : ["*No assignments or vacancies recorded*"]});
    }
    if (!entries.length) entries.push({title:"*No assignments or vacancies recorded*"});
    entries.forEach((entry,i) => {
      const last=i === entries.length-1;
      lines.push(`${last ? "└──" : "├──"} ${entry.title}`);
      entry.children?.forEach((child,j) => lines.push(`${last ? "    " : "│   "}${j === entry.children!.length-1 ? "└──" : "├──"} ${child}`));
    });
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
