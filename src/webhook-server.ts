import { createServer, type Server } from "node:http";
import { webhookCallback, type Bot } from "grammy";
import type { Logger } from "pino";

export interface WebhookServerOptions {
  readonly bot: Bot;
  readonly healthcheckPath: string;
  readonly host: string;
  readonly logger: Logger;
  readonly port: number;
  readonly webhookSecret?: string;
  readonly webhookUrl: string;
}

export interface RunningWebhookServer {
  close(): Promise<void>;
  readonly healthcheckPath: string;
  readonly server: Server;
  readonly webhookPath: string;
}

export async function startWebhookServer({
  bot,
  healthcheckPath,
  host,
  logger,
  port,
  webhookSecret,
  webhookUrl,
}: WebhookServerOptions): Promise<RunningWebhookServer> {
  const webhookPath = normalizePath(new URL(webhookUrl).pathname);
  const normalizedHealthcheckPath = normalizePath(healthcheckPath);
  const webhookHandler = webhookCallback(
    bot,
    "http",
    webhookSecret === undefined ? {} : { secretToken: webhookSecret },
  );
  const server = createServer((request, response) => {
    const requestPath = getRequestPath(request.url);

    if (request.method === "GET" && requestPath === normalizedHealthcheckPath) {
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (requestPath !== webhookPath) {
      response.writeHead(404).end("not found");
      return;
    }

    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "POST" }).end("method not allowed");
      return;
    }

    void webhookHandler(request, response).catch((error: unknown) => {
      logger.error({ err: error }, "webhook request failed");

      if (!response.headersSent) {
        response.writeHead(500);
      }

      response.end("internal server error");
    });
  });

  await listen(server, port, host);

  return {
    async close() {
      await closeServer(server);
    },
    healthcheckPath: normalizedHealthcheckPath,
    server,
    webhookPath,
  };
}

function getRequestPath(requestUrl: string | undefined): string {
  return normalizePath(new URL(requestUrl ?? "/", "http://localhost").pathname);
}

function normalizePath(path: string): string {
  const normalizedPath = path.trim();

  if (normalizedPath.length === 0 || normalizedPath === "/") {
    return "/";
  }

  return normalizedPath.endsWith("/")
    ? normalizedPath.slice(0, -1)
    : normalizedPath;
}

async function listen(
  server: Server,
  port: number,
  host: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}
