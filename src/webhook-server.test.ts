import { afterEach, describe, expect, it } from "vitest";
import pino from "pino";

import { createHealthBot } from "./bot.js";
import {
  startWebhookServer,
  type RunningWebhookServer,
} from "./webhook-server.js";

const runningServers: RunningWebhookServer[] = [];

describe("startWebhookServer", () => {
  afterEach(async () => {
    await Promise.all(runningServers.splice(0).map((server) => server.close()));
  });

  it("serves a JSON health check", async () => {
    const server = await startTestServer();

    const response = await fetch(serverUrl(server, "/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns 404 outside the health and webhook routes", async () => {
    const server = await startTestServer();

    const response = await fetch(serverUrl(server, "/missing"));

    expect(response.status).toBe(404);
  });

  it("rejects non-POST webhook requests", async () => {
    const server = await startTestServer();

    const response = await fetch(serverUrl(server, "/telegram/webhook"));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("passes webhook secret validation to grammY", async () => {
    const server = await startTestServer();

    const response = await fetch(serverUrl(server, "/telegram/webhook"), {
      body: JSON.stringify({ update_id: 1 }),
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong-secret",
      },
      method: "POST",
    });

    expect(response.status).toBe(401);
  });
});

async function startTestServer(): Promise<RunningWebhookServer> {
  const server = await startWebhookServer({
    bot: createHealthBot({
      botInfo: {
        allows_users_to_create_topics: false,
        can_connect_to_business: false,
        can_join_groups: true,
        can_manage_bots: false,
        can_read_all_group_messages: false,
        first_name: "Healthbot",
        has_main_web_app: false,
        has_topics_enabled: false,
        id: 999,
        is_bot: true,
        supports_inline_queries: false,
        supports_join_request_queries: false,
        username: "healthbot",
      },
      logger: pino({ enabled: false }),
      token: "123456:test-token",
    }),
    healthcheckPath: "/health",
    host: "127.0.0.1",
    logger: pino({ enabled: false }),
    port: 0,
    webhookSecret: "expected-secret",
    webhookUrl: "https://example.com/telegram/webhook",
  });

  runningServers.push(server);

  return server;
}

function serverUrl(server: RunningWebhookServer, path: string): string {
  const address = server.server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected webhook server to listen on a TCP address");
  }

  return `http://127.0.0.1:${address.port}${path}`;
}
