import { z } from "zod";

const configSchema = z
  .object({
    BOT_TOKEN: z.string().trim().min(1, "BOT_TOKEN is required"),
    BOT_MODE: z.enum(["long-polling", "webhook"]).default("long-polling"),
    HEALTHCHECK_PATH: z
      .string()
      .trim()
      .regex(/^\//u, "HEALTHCHECK_PATH must start with /")
      .default("/health"),
    HOST: z.string().trim().min(1).default("0.0.0.0"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    WEBHOOK_SECRET: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9_-]{1,256}$/u,
        "WEBHOOK_SECRET must be 1-256 chars: A-Z, a-z, 0-9, _ or -",
      )
      .optional(),
    WEBHOOK_URL: z.string().trim().url().optional(),
  })
  .superRefine((config, ctx) => {
    if (config.BOT_MODE !== "webhook") {
      return;
    }

    if (config.WEBHOOK_URL === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "WEBHOOK_URL is required when BOT_MODE=webhook",
        path: ["WEBHOOK_URL"],
      });
      return;
    }

    const webhookUrl = new URL(config.WEBHOOK_URL);

    if (webhookUrl.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        message: "WEBHOOK_URL must use https",
        path: ["WEBHOOK_URL"],
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment: ${details}`);
  }

  return result.data;
}
