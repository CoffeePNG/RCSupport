import { db } from "./connect";
import { Todo } from "../types/ticket";

function rowToTodo(row: any): Todo {
  return {
    id: row.id,
    guildId: row.guild_id,
    content: row.content,
    assigneeId: row.assignee_id,
    createdBy: row.created_by,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
  };
}

export function createTodo(guildId: string, content: string, createdBy: string): Todo {
  const info = db
    .prepare(
      `INSERT INTO todos (guild_id, content, created_by, status, created_at)
       VALUES (?, ?, ?, 'open', ?)`
    )
    .run(guildId, content, createdBy, Date.now());
  return rowToTodo(db.prepare(`SELECT * FROM todos WHERE id = ?`).get(info.lastInsertRowid));
}

export function getTodoById(id: number): Todo | null {
  const row = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(id) as any;
  return row ? rowToTodo(row) : null;
}

export function listOpenTodos(guildId: string): Todo[] {
  const rows = db
    .prepare(`SELECT * FROM todos WHERE guild_id = ? AND status = 'open' ORDER BY created_at ASC`)
    .all(guildId) as any[];
  return rows.map(rowToTodo);
}

export function listAssignedTodos(guildId: string, userId: string): Todo[] {
  const rows = db
    .prepare(
      `SELECT * FROM todos WHERE guild_id = ? AND assignee_id = ? AND status = 'open' ORDER BY created_at ASC`
    )
    .all(guildId, userId) as any[];
  return rows.map(rowToTodo);
}

export function assignTodo(id: number, assigneeId: string | null): Todo | null {
  db.prepare(`UPDATE todos SET assignee_id = ? WHERE id = ?`).run(assigneeId, id);
  return getTodoById(id);
}

export function completeTodo(id: number, userId: string): Todo | null {
  db.prepare(
    `UPDATE todos SET status = 'done', completed_at = ?, completed_by = ? WHERE id = ? AND status = 'open'`
  ).run(Date.now(), userId, id);
  return getTodoById(id);
}

export function removeTodo(id: number): boolean {
  const info = db.prepare(`DELETE FROM todos WHERE id = ?`).run(id);
  return info.changes > 0;
}
