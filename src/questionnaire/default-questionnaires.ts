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
      {
        id: "height",
        type: "number",
        text: "Рост, см",
        integer: true,
        min: 80,
        max: 250,
      },
      {
        id: "weight",
        type: "number",
        text: "Вес, кг",
        min: 20,
        max: 500,
      },
      {
        id: "main_goal",
        type: "multi",
        text: "Что вас беспокоит больше всего?",
        minSelected: 1,
        options: [
          { id: "skin", label: "Кожа" },
          { id: "energy", label: "Энергия" },
          { id: "weight", label: "Вес" },
          { id: "sleep", label: "Сон" },
          { id: "stress", label: "Стресс" },
          { id: "mood", label: "Настроение" },
          { id: "hormones", label: "Гормоны" },
          {
            id: "longevity",
            label: "Долголетие и здоровое старение",
          },
          { id: "menopause", label: "Менопауза" },
          { id: "other", label: "Другое" },
        ],
      },
      {
        id: "menstrual_status",
        type: "single",
        text: "Менструальный статус",
        options: [
          { id: "regular_cycle", label: "Регулярный цикл" },
          { id: "irregular_cycle", label: "Нерегулярный цикл" },
          { id: "perimenopause", label: "Перименопауза" },
          { id: "menopause", label: "Менопауза" },
          { id: "post_hysterectomy", label: "После гистерэктомии" },
          { id: "pregnancy", label: "Беременность" },
          { id: "breastfeeding", label: "Грудное вскармливание" },
        ],
      },
      {
        id: "cycle_length",
        type: "single",
        text: "Средняя длина цикла",
        when: ({ getAnswer }) =>
          hasCycleQuestions(getAnswer("menstrual_status")),
        options: [
          { id: "unknown", label: "Не знаю" },
          { id: "21_25", label: "21–25 дней" },
          { id: "26_30", label: "26–30 дней" },
          { id: "31_35", label: "31–35 дней" },
          { id: "over_35", label: "Более 35 дней" },
        ],
      },
      {
        id: "pms_symptoms",
        type: "multi",
        text: "Симптомы ПМС",
        minSelected: 1,
        when: ({ getAnswer }) =>
          hasCycleQuestions(getAnswer("menstrual_status")),
        options: [
          { id: "none", label: "Нет" },
          { id: "irritability", label: "Раздражительность" },
          { id: "anxiety", label: "Тревожность" },
          { id: "swelling", label: "Отеки" },
          { id: "headache", label: "Головная боль" },
          { id: "sweet_cravings", label: "Тяга к сладкому" },
          { id: "pain", label: "Боль" },
          { id: "mood_swings", label: "Перепады настроения" },
        ],
      },
      {
        id: "skin_type",
        type: "single",
        text: "Тип кожи",
        options: [
          { id: "dry", label: "Сухая" },
          { id: "normal", label: "Нормальная" },
          { id: "combination", label: "Комбинированная" },
          { id: "oily", label: "Жирная" },
          { id: "unknown", label: "Не знаю" },
        ],
      },
      {
        id: "skin_concerns",
        type: "multi",
        text: "Что беспокоит больше всего в состоянии кожи?",
        minSelected: 1,
        options: [
          { id: "dryness", label: "Сухость" },
          { id: "wrinkles", label: "Морщины" },
          { id: "acne", label: "Акне" },
          { id: "pigmentation", label: "Пигментация" },
          { id: "redness", label: "Покраснение" },
          { id: "loss_of_firmness", label: "Потеря упругости" },
          { id: "rosacea", label: "Розацеа" },
          { id: "dark_circles", label: "Темные круги" },
          { id: "puffiness", label: "Отечность" },
        ],
      },
      {
        id: "regular_skincare",
        type: "multi",
        text: "Что вы используете регулярно?",
        minSelected: 1,
        options: [
          { id: "spf", label: "SPF" },
          { id: "retinol", label: "Ретинол" },
          { id: "vitamin_c", label: "Витамин C" },
          { id: "peptides", label: "Пептиды" },
          { id: "acids", label: "Кислоты" },
          { id: "moisturizer", label: "Увлажняющий крем" },
          { id: "masks", label: "Маски" },
          { id: "none", label: "Ничего из перечисленного" },
        ],
      },
      {
        id: "chronic_conditions",
        type: "multi",
        text: "Есть ли у вас следующие состояния?",
        minSelected: 1,
        options: [
          { id: "none", label: "Нет" },
          { id: "chronic_urticaria", label: "Хроническая крапивница" },
          { id: "allergy", label: "Аллергия" },
          { id: "asthma", label: "Астма" },
          { id: "autoimmune", label: "Аутоиммунное заболевание" },
          { id: "thyroid", label: "Заболевание щитовидной железы" },
          { id: "pcos", label: "СПКЯ" },
          { id: "endometriosis", label: "Эндометриоз" },
          { id: "insulin_resistance", label: "Инсулинорезистентность" },
          { id: "prediabetes", label: "Преддиабет" },
          { id: "diabetes", label: "Диабет" },
          { id: "migraine", label: "Мигрень" },
          { id: "anxiety_disorder", label: "Тревожное расстройство" },
          { id: "depression", label: "Депрессия" },
          { id: "other", label: "Другое" },
        ],
      },
      {
        id: "medications",
        type: "multi",
        text: "Принимаете ли вы постоянно препараты?",
        minSelected: 1,
        options: [
          { id: "none", label: "Ничего" },
          { id: "contraceptives", label: "Контрацептивы" },
          { id: "hrt", label: "ЗГТ" },
          { id: "thyroid_medication", label: "Препараты щитовидной железы" },
          { id: "antihistamines", label: "Антигистаминные" },
          { id: "antidepressants", label: "Антидепрессанты" },
          { id: "glp_1", label: "GLP-1 препараты" },
          { id: "other", label: "Другое" },
        ],
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

function hasCycleQuestions(menstrualStatus: unknown): boolean {
  return (
    menstrualStatus === "regular_cycle" ||
    menstrualStatus === "irregular_cycle" ||
    menstrualStatus === "perimenopause"
  );
}
