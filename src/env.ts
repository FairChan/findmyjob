import { z } from "zod";

const APP_ENV_VALUES = ["production", "staging", "ci", "development"] as const;
export type AppEnv = (typeof APP_ENV_VALUES)[number];

function dbUsername(url: string): string | null {
  try {
    return new URL(url).username;
  } catch {
    return null;
  }
}

const dbUrl = z.string().url();

const schema = z
  .object({
    APP_ENV: z.enum(APP_ENV_VALUES).default("development"),
    APP_URL: z.string().url(),

    DATABASE_URL: dbUrl,
    MIGRATE_DATABASE_URL: dbUrl,
    WORKER_DATABASE_URL: dbUrl.optional(),
    SHADOW_DATABASE_URL: dbUrl.optional(),
    TEST_DATABASE_URL: dbUrl.optional(),
    TEST_ADMIN_DATABASE_URL: dbUrl.optional(),

    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().url(),

    PII_KEYS: z.string().min(1),
    PII_ACTIVE_KEY_ID: z.string().default("v1"),

    TURNSTILE_SITE_KEY: z.string().min(1),
    TURNSTILE_SECRET_KEY: z.string().min(1),

    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),

    EMAIL_PROVIDER: z.enum(["smtp", "resend", "ses"]).default("smtp"),
    EMAIL_FROM: z.string().min(1),
    SMTP_URL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),

    SENTRY_DSN: z.string().optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),

    HSTS_MAX_AGE: z.coerce.number().int().positive().default(300),
    APP_TAG: z.string().optional(),

    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().optional(),

    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL_PARSE: z.string().optional(),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.APP_ENV === "production") {
      // Enforce HTTPS
      if (!data.APP_URL.startsWith("https://")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["APP_URL"],
          message: "APP_URL must use https:// in production",
        });
      }

      // Forbid Cloudflare Turnstile test secret keys (always-pass / always-fail prefixes)
      if (data.TURNSTILE_SECRET_KEY.startsWith("1x0000000000000000000000000000000")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["TURNSTILE_SECRET_KEY"],
          message: "Turnstile test secret key is not allowed in production",
        });
      }

      // Forbid connecting as postgres superuser or findmyjob_owner from app/worker connections
      for (const key of ["DATABASE_URL", "WORKER_DATABASE_URL"] as const) {
        const url = data[key];
        if (!url) continue;
        const user = dbUsername(url);
        if (user === "postgres" || user === "findmyjob_owner") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} must not use postgres or findmyjob_owner in production`,
          });
        }
      }
    }

    // Email provider-specific requirements
    if (data.EMAIL_PROVIDER === "smtp" && !data.SMTP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_URL"],
        message: "SMTP_URL is required when EMAIL_PROVIDER=smtp",
      });
    }
    if (data.EMAIL_PROVIDER === "resend" && !data.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
      });
    }
  });

function parseEnv() {
  if (process.env.SKIP_ENV_VALIDATION) {
    return process.env as unknown as z.infer<typeof schema>;
  }

  const result = schema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((e) => `  ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  return result.data;
}

export const env = parseEnv();
