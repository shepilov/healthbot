import type { QuestionnaireDefinition } from "./types.js";

export const PROFILE_QUESTIONNAIRE_ID = "profile";
export const DAILY_QUESTIONNAIRE_ID = "daily";
export const WEEKLY_QUESTIONNAIRE_ID = "weekly";
export const MONTHLY_QUESTIONNAIRE_ID = "monthly";

export const defaultQuestionnaires: readonly QuestionnaireDefinition[] = [
  {
    id: PROFILE_QUESTIONNAIRE_ID,
    title: "Профиль",
    questions: [
      {
        id: "age",
        type: "number",
        text: "Возраст",
        integer: true,
        min: 1,
        max: 120,
      },
    ],
  },
  {
    id: DAILY_QUESTIONNAIRE_ID,
    title: "Ежедневный чек-ин",
    questions: [
      {
        id: "mood",
        type: "scale_1_10",
        text: "Настроение от 1 до 10",
      },
    ],
  },
  {
    id: WEEKLY_QUESTIONNAIRE_ID,
    title: "Еженедельный чек-ин",
    questions: [
      {
        id: "weight",
        type: "number",
        text: "Вес",
        min: 1,
        max: 500,
      },
    ],
  },
  {
    id: MONTHLY_QUESTIONNAIRE_ID,
    title: "Ежемесячный чек-ин",
    questions: [
      {
        id: "monthly_labs",
        type: "lab_panel",
        text: "Анализы за месяц",
        fields: [
          {
            id: "ferritin",
            label: "Ферритин",
            min: 0,
          },
          {
            id: "vitamin_d",
            label: "Витамин D",
            min: 0,
          },
        ],
      },
    ],
  },
];
