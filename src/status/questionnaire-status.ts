import type {
  CheckInPeriod,
  DomainEvent,
  QuestionnaireId,
  StoredDomainEvent,
} from "../domain/index.js";
import type { Projector } from "../domain/index.js";

export interface QuestionnaireStatus {
  readonly completed: boolean;
  readonly started: boolean;
}

export interface PeriodCheckInStatus {
  readonly completedAt: Date;
  readonly eventId: string;
  readonly period: CheckInPeriod;
  readonly periodKey: string;
  readonly questionnaireId: QuestionnaireId;
  readonly sequence: number;
  readonly userSequence: number;
}

export interface UserStatusReadModel {
  readonly checkIns: Readonly<
    Record<CheckInPeriod, PeriodCheckInStatus | undefined>
  >;
  readonly profile: QuestionnaireStatus;
}

export interface UserStatusProjectorOptions {
  readonly profileQuestionnaireId: QuestionnaireId;
}

type QuestionnaireLifecycleEvent = Extract<
  StoredDomainEvent,
  {
    readonly type:
      | "QuestionnaireCancelled"
      | "QuestionnaireCompleted"
      | "QuestionnaireStarted";
  }
>;

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

export function createUserStatusProjector({
  profileQuestionnaireId,
}: UserStatusProjectorOptions): Projector<UserStatusReadModel> {
  return {
    initialState() {
      return {
        checkIns: {
          daily: undefined,
          monthly: undefined,
          weekly: undefined,
        },
        profile: {
          completed: false,
          started: false,
        },
      };
    },
    apply(state, event) {
      if (isQuestionnaireLifecycleEvent(event)) {
        if (event.payload.questionnaireId !== profileQuestionnaireId) {
          return state;
        }

        return {
          ...state,
          profile: {
            completed: event.type === "QuestionnaireCompleted",
            started: true,
          },
        };
      }

      if (event.type !== "PeriodCheckInCompleted") {
        return state;
      }

      return {
        ...state,
        checkIns: {
          ...state.checkIns,
          [event.payload.period]: {
            completedAt: event.occurredAt,
            eventId: event.id,
            period: event.payload.period,
            periodKey: event.payload.periodKey,
            questionnaireId: event.payload.questionnaireId,
            sequence: event.sequence,
            userSequence: event.userSequence,
          },
        },
      };
    },
  };
}

export function projectUserStatus(
  events: readonly StoredDomainEvent[],
  options: UserStatusProjectorOptions,
): UserStatusReadModel {
  const projector = createUserStatusProjector(options);

  return events.reduce(
    (state, event) => projector.apply(state, event),
    projector.initialState(),
  );
}

function isQuestionnaireLifecycleEvent(
  event: StoredDomainEvent,
): event is QuestionnaireLifecycleEvent {
  return (
    event.type === "QuestionnaireStarted" ||
    event.type === "QuestionnaireCompleted" ||
    event.type === "QuestionnaireCancelled"
  );
}
