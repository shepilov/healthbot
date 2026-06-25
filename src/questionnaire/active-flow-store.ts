import type { ActiveQuestionnaireFlow } from "./types.js";
import type { UserId } from "../domain/index.js";

export interface ActiveFlowStore {
  clear(userId: UserId): Promise<void>;
  get(userId: UserId): Promise<ActiveQuestionnaireFlow | undefined>;
  set(flow: ActiveQuestionnaireFlow): Promise<void>;
}

export class InMemoryActiveFlowStore implements ActiveFlowStore {
  private readonly flowsByUser = new Map<UserId, ActiveQuestionnaireFlow>();

  async clear(userId: UserId): Promise<void> {
    this.flowsByUser.delete(userId);
  }

  async get(userId: UserId): Promise<ActiveQuestionnaireFlow | undefined> {
    const flow = this.flowsByUser.get(userId);

    return flow === undefined ? undefined : cloneFlow(flow);
  }

  async set(flow: ActiveQuestionnaireFlow): Promise<void> {
    this.flowsByUser.set(flow.userId, cloneFlow(flow));
  }
}

function cloneFlow(flow: ActiveQuestionnaireFlow): ActiveQuestionnaireFlow {
  return {
    ...flow,
    answers: { ...flow.answers },
    multiSelections: Object.fromEntries(
      Object.entries(flow.multiSelections).map(([questionId, optionIds]) => [
        questionId,
        [...optionIds],
      ]),
    ),
  };
}
