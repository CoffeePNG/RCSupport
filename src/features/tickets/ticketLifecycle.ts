/** One in-process queue for ownership and closure changes to each ticket. */
const queues = new Map<number, Promise<unknown>>();
export async function withTicketLock<T>(id: number, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queues.set(id, current);
  try { return await current; }
  finally { if (queues.get(id) === current) queues.delete(id); }
}
