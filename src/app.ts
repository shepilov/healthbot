import {
  InMemoryEventStore,
  InProcessEventBus,
  type EventStore,
} from "./domain/index.js";
import { defaultQuestionnaires } from "./questionnaire/default-questionnaires.js";
import {
  InMemoryActiveFlowStore,
  QuestionnaireEngine,
  type ActiveFlowStore,
  type QuestionnaireDefinition,
} from "./questionnaire/index.js";

export interface HealthBotApp {
  readonly activeFlowStore: ActiveFlowStore;
  readonly eventBus: InProcessEventBus;
  readonly eventStore: EventStore;
  readonly questionnaireEngine: QuestionnaireEngine;
}

export interface CreateInMemoryHealthBotAppOptions {
  readonly questionnaires?: readonly QuestionnaireDefinition[];
}

export function createInMemoryHealthBotApp({
  questionnaires = defaultQuestionnaires,
}: CreateInMemoryHealthBotAppOptions = {}): HealthBotApp {
  const activeFlowStore = new InMemoryActiveFlowStore();
  const eventBus = new InProcessEventBus();
  const eventStore = new InMemoryEventStore();
  const questionnaireEngine = new QuestionnaireEngine({
    activeFlowStore,
    eventBus,
    eventStore,
    questionnaires,
  });

  return {
    activeFlowStore,
    eventBus,
    eventStore,
    questionnaireEngine,
  };
}
