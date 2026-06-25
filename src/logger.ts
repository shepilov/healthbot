import pino from "pino";

import type { AppConfig } from "./config.js";

const redactedHealthDataPaths = [
  "answer",
  "answers",
  "*.answer",
  "*.answers",
  "event.payload.answer",
  "event.payload.answers",
  "questionnaire.answer",
  "questionnaire.answers",
];

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">) {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: redactedHealthDataPaths,
      censor: "[REDACTED]",
    },
  });
}
