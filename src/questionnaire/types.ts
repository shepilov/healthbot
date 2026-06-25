import type {
  AnswerValue,
  ChatId,
  QuestionId,
  QuestionnaireId,
  UserId,
} from "../domain/index.js";

export type AnswerMap = Readonly<Record<QuestionId, AnswerValue>>;

export interface QuestionContext {
  readonly answers: AnswerMap;
  getAnswer(questionId: QuestionId): AnswerValue | undefined;
  hasAnswer(questionId: QuestionId): boolean;
}

export type QuestionVisibility = (context: QuestionContext) => boolean;

export interface QuestionOption {
  readonly id: string;
  readonly label: string;
  readonly value?: AnswerValue;
}

interface BaseQuestion<TType extends string> {
  readonly id: QuestionId;
  readonly required?: boolean;
  readonly text: string;
  readonly type: TType;
  readonly when?: QuestionVisibility;
}

export interface TextQuestion extends BaseQuestion<"text"> {
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly trim?: boolean;
}

export interface NumberQuestion extends BaseQuestion<"number"> {
  readonly integer?: boolean;
  readonly max?: number;
  readonly min?: number;
}

export type ScaleQuestion = BaseQuestion<"scale_1_10">;

export interface SingleQuestion extends BaseQuestion<"single"> {
  readonly options: readonly QuestionOption[];
}

export interface MultiQuestion extends BaseQuestion<"multi"> {
  readonly doneLabel?: string;
  readonly maxSelected?: number;
  readonly minSelected?: number;
  readonly options: readonly QuestionOption[];
}

export type PhotoQuestion = BaseQuestion<"photo">;

export interface LabPanelField {
  readonly id: string;
  readonly label: string;
  readonly max?: number;
  readonly min?: number;
  readonly required?: boolean;
  readonly unit?: string;
}

export interface LabPanelQuestion extends BaseQuestion<"lab_panel"> {
  readonly fields: readonly LabPanelField[];
}

export type QuestionDefinition =
  | LabPanelQuestion
  | MultiQuestion
  | NumberQuestion
  | PhotoQuestion
  | ScaleQuestion
  | SingleQuestion
  | TextQuestion;

export interface QuestionnaireDefinition {
  readonly id: QuestionnaireId;
  readonly questions: readonly QuestionDefinition[];
  readonly title?: string;
}

export interface ActiveQuestionnaireFlow {
  readonly answers: AnswerMap;
  readonly chatId?: ChatId;
  readonly currentQuestionId: QuestionId;
  readonly multiSelections: Readonly<Record<QuestionId, readonly string[]>>;
  readonly questionnaireId: QuestionnaireId;
  readonly userId: UserId;
}

export type QuestionnaireAnswerInput =
  | {
      readonly fileId: string;
      readonly fileUniqueId?: string;
      readonly type: "photo";
    }
  | {
      readonly optionId: string;
      readonly type: "multi_toggle";
    }
  | {
      readonly optionId: string;
      readonly type: "single";
    }
  | {
      readonly type: "lab_panel";
      readonly values: Readonly<
        Record<string, number | string | null | undefined>
      >;
    }
  | {
      readonly type: "multi_done";
    }
  | {
      readonly type: "number";
      readonly value: number | string;
    }
  | {
      readonly type: "scale_1_10";
      readonly value: number | string;
    }
  | {
      readonly type: "text";
      readonly value: string;
    };
