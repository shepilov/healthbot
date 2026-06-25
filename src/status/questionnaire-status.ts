import type {
  DomainEvent,
  QuestionnaireId,
  StoredDomainEvent,
} from "../domain/index.js";

export interface QuestionnaireStatus {
  readonly completed: boolean;
  readonly started: boolean;
}

export function getQuestionnaireStatus(
  events: readonly (DomainEvent | StoredDomainEvent)[],
  questionnaireId: QuestionnaireId,
): QuestionnaireStatus {
  const latestLifecycleEvent = events.findLast(
    (event) =>
      (event.type === "QuestionnaireStarted" ||
        event.type === "QuestionnaireCompleted" ||
        event.type === "QuestionnaireCancelled") &&
      event.payload.questionnaireId === questionnaireId,
  );

  return {
    completed: latestLifecycleEvent?.type === "QuestionnaireCompleted",
    started: latestLifecycleEvent !== undefined,
  };
}
