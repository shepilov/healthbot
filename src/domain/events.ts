import { randomUUID } from "node:crypto";

export type UserId = string;
export type ChatId = string;
export type QuestionnaireId = string;
export type QuestionId = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type AnswerValue = JsonValue;

export interface EventMetadata {
  readonly causationId?: string;
  readonly correlationId?: string;
  readonly source?: string;
}

export interface UserSeenPayload {
  readonly telegramUserId: number;
  readonly chatId: number;
  readonly username?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly languageCode?: string;
}

export interface QuestionnaireStartedPayload {
  readonly questionnaireId: QuestionnaireId;
}

export interface AnswerRecordedPayload {
  readonly questionnaireId: QuestionnaireId;
  readonly questionId: QuestionId;
  readonly answer: AnswerValue;
}

export interface AnswerRejectedPayload {
  readonly questionnaireId: QuestionnaireId;
  readonly questionId: QuestionId;
  readonly reason: string;
  readonly rawInput?: string;
}

export interface QuestionnaireCompletedPayload {
  readonly questionnaireId: QuestionnaireId;
}

export interface QuestionnaireCancelledPayload {
  readonly questionnaireId: QuestionnaireId;
  readonly reason?: string;
}

export interface PhotoReceivedPayload {
  readonly questionnaireId: QuestionnaireId;
  readonly questionId: QuestionId;
  readonly fileId: string;
  readonly fileUniqueId?: string;
}

export type CheckInPeriod = "daily" | "weekly" | "monthly";

export interface PeriodCheckInCompletedPayload {
  readonly questionnaireId: QuestionnaireId;
  readonly period: CheckInPeriod;
  readonly periodKey: string;
}

export interface DomainEventPayloads {
  readonly UserSeen: UserSeenPayload;
  readonly QuestionnaireStarted: QuestionnaireStartedPayload;
  readonly AnswerRecorded: AnswerRecordedPayload;
  readonly AnswerRejected: AnswerRejectedPayload;
  readonly QuestionnaireCompleted: QuestionnaireCompletedPayload;
  readonly QuestionnaireCancelled: QuestionnaireCancelledPayload;
  readonly PhotoReceived: PhotoReceivedPayload;
  readonly PeriodCheckInCompleted: PeriodCheckInCompletedPayload;
}

export type DomainEventType = keyof DomainEventPayloads;

type DomainEventBase<TType extends DomainEventType> = {
  readonly id: string;
  readonly type: TType;
  readonly userId: UserId;
  readonly chatId?: ChatId;
  readonly occurredAt: Date;
  readonly payload: DomainEventPayloads[TType];
  readonly metadata?: EventMetadata;
};

export type DomainEvent<TType extends DomainEventType = DomainEventType> = {
  [EventType in TType]: DomainEventBase<EventType>;
}[TType];

export type CreateDomainEventInput<TType extends DomainEventType> = {
  readonly type: TType;
  readonly userId: UserId;
  readonly chatId?: ChatId;
  readonly payload: DomainEventPayloads[TType];
  readonly id?: string;
  readonly occurredAt?: Date;
  readonly metadata?: EventMetadata;
};

export function createDomainEvent<TType extends DomainEventType>(
  input: CreateDomainEventInput<TType>,
): DomainEvent<TType> {
  const event = {
    id: input.id ?? randomUUID(),
    type: input.type,
    userId: input.userId,
    occurredAt: input.occurredAt ?? new Date(),
    payload: input.payload,
    ...(input.chatId === undefined ? {} : { chatId: input.chatId }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };

  return event as DomainEvent<TType>;
}
