import pino from "pino";
import { describe, expect, it } from "vitest";

import { createHealthBot } from "./bot.js";

describe("createHealthBot", () => {
  it("creates a grammY bot instance", () => {
    const bot = createHealthBot({
      token: "123456:test-token",
      logger: pino({ enabled: false }),
    });

    expect(bot).toBeDefined();
  });
});
