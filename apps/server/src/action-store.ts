import { randomUUID } from "node:crypto";

type Action = { userId: number; type: "refresh_usage"; expiresAt: number };

export class ActionStore {
  private readonly actions = new Map<string, Action>();

  create(userId: number) {
    const id = randomUUID();
    this.actions.set(id, { userId, type: "refresh_usage", expiresAt: Date.now() + 10 * 60_000 });
    return id;
  }

  consume(id: string, userId: number) {
    const action = this.actions.get(id);
    this.actions.delete(id);
    if (!action || action.userId !== userId || action.expiresAt < Date.now()) return undefined;
    return action;
  }
}

