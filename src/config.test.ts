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
      LOG_LEVEL: "debug",
      NODE_ENV: "development",
    });
  });

  it("fails when BOT_TOKEN is missing", () => {
    expect(() => loadConfig({})).toThrow("Invalid environment");
  });
});
