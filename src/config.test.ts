import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("loads valid environment values", () => {
    expect(
      loadConfig({
        BOT_TOKEN: "123456:test-token",
        LOG_LEVEL: "debug",
      }),
    ).toEqual({
      BOT_TOKEN: "123456:test-token",
      BOT_MODE: "long-polling",
      HEALTHCHECK_PATH: "/health",
      HOST: "0.0.0.0",
      LOG_LEVEL: "debug",
      NODE_ENV: "development",
      PORT: 3000,
    });
  });

  it("fails when BOT_TOKEN is missing", () => {
    expect(() => loadConfig({})).toThrow("Invalid environment");
  });

  it("loads webhook environment values", () => {
    expect(
      loadConfig({
        BOT_MODE: "webhook",
        BOT_TOKEN: "123456:test-token",
        HEALTHCHECK_PATH: "/ready",
        HOST: "127.0.0.1",
        PORT: "8080",
        WEBHOOK_SECRET: "secret-token_1",
        WEBHOOK_URL: "https://example.com/telegram/webhook",
      }),
    ).toMatchObject({
      BOT_MODE: "webhook",
      HEALTHCHECK_PATH: "/ready",
      HOST: "127.0.0.1",
      PORT: 8080,
      WEBHOOK_SECRET: "secret-token_1",
      WEBHOOK_URL: "https://example.com/telegram/webhook",
    });
  });

  it("requires WEBHOOK_URL in webhook mode", () => {
    expect(() =>
      loadConfig({
        BOT_MODE: "webhook",
        BOT_TOKEN: "123456:test-token",
      }),
    ).toThrow("WEBHOOK_URL is required");
  });

  it("requires HTTPS webhook URLs", () => {
    expect(() =>
      loadConfig({
        BOT_MODE: "webhook",
        BOT_TOKEN: "123456:test-token",
        WEBHOOK_URL: "http://example.com/telegram/webhook",
      }),
    ).toThrow("WEBHOOK_URL must use https");
  });
});
