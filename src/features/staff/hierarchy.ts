export interface Position {
  id: string;
  department: string;
  team: string | null;
  title: string;
  seniority?: boolean;
}
/** Order is presentation order, not a numeric permission hierarchy. */
export const departments = ["Management", "Engineering", "Community", "Shared Support"] as const;
export const positions: readonly Position[] = [
  { id: "director", department: "Management", team: null, title: "Director" },
  { id: "general-manager", department: "Management", team: null, title: "General Manager" },
  { id: "project-coordinator", department: "Management", team: null, title: "Project Coordinator" },
  { id: "engineering-manager", department: "Engineering", team: null, title: "Engineering Department Manager" },
  { id: "engineering-administrator", department: "Engineering", team: null, title: "Administrator", seniority: true },
  { id: "developer", department: "Engineering", team: null, title: "Developer" },
  { id: "build-administrator", department: "Engineering", team: "Build Team", title: "Administrator", seniority: true },
  { id: "builder", department: "Engineering", team: "Build Team", title: "Builder" },
  { id: "trial-builder", department: "Engineering", team: "Build Team", title: "Trial Builder" },
  { id: "gameplay-administrator", department: "Engineering", team: "Gameplay Team", title: "Administrator", seniority: true },
  { id: "community-manager", department: "Community", team: null, title: "Community Department Manager" },
  { id: "community-administrator", department: "Community", team: null, title: "Administrator", seniority: true },
  { id: "moderation-administrator", department: "Community", team: "Moderation Team", title: "Administrator", seniority: true },
  { id: "senior-moderator", department: "Community", team: "Moderation Team", title: "Sr. Moderator" },
  { id: "moderator", department: "Community", team: "Moderation Team", title: "Moderator" },
  { id: "public-relations-administrator", department: "Community", team: "Public Relations Team", title: "Administrator", seniority: true },
  { id: "support-administrator", department: "Community", team: "Support Team", title: "Administrator", seniority: true },
  { id: "helper", department: "Shared Support", team: null, title: "Helper" },
];
export const positionLabel = (position: Position) => [position.department, position.team, position.title].filter(Boolean).join(" → ");
export interface AssignmentInput { position: string; senior: boolean; designation: string; }
export function validateAssignment(input: AssignmentInput): AssignmentInput {
  const position = positions.find(value => value.id === input.position);
  if (!position) throw new Error("Choose a valid position from autocomplete.");
  if (input.senior && !position.seniority) throw new Error("Seniority is only an Administrator attribute. Choose Sr. Moderator as its own position.");
  const designation = input.designation.trim();
  if (designation && !/^[A-Za-z0-9 -]{1,16}$/.test(designation)) throw new Error("Designation must be 1–16 letters, numbers, spaces or hyphens.");
  return { position: position.id, senior: input.senior, designation };
}
