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
    NEXT_PUBLIC_APP_TAG: z.string().optional(),
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: z.string().optional(),

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

    // Worker job healthcheck ping URLs (M7-T14); one per scheduled job
    // env.example stores these as empty strings; coerce '' → undefined before URL validation
    HEALTHCHECKS_EXAMPLE: z.preprocess(v => (v === '' ? undefined : v), z.string().url().optional()),
    HEALTHCHECKS_PRUNE_RATE_LIMIT: z.preprocess(v => (v === '' ? undefined : v), z.string().url().optional()),
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

      // Require a strong auth secret in production
      if (data.BETTER_AUTH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["BETTER_AUTH_SECRET"],
          message: "BETTER_AUTH_SECRET must be at least 32 characters in production",
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

    // Validate PII_KEYS: each entry must be keyId:<base64 32 bytes>; active key must exist
    if (data.PII_KEYS) {
      const piiKeyIds: string[] = []
      for (const entry of data.PII_KEYS.split(",")) {
        const sep = entry.indexOf(":")
        if (sep === -1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["PII_KEYS"],
            message: `Invalid PII_KEYS entry (expected keyId:base64): ${entry}`,
          })
          continue
        }
        const keyId = entry.slice(0, sep)
        const keyBytes = Buffer.from(entry.slice(sep + 1), "base64")
        piiKeyIds.push(keyId)
        if (keyBytes.length !== 32) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["PII_KEYS"],
            message: `PII key "${keyId}" must be exactly 32 bytes, got ${keyBytes.length}`,
          })
        }
      }
      if (!piiKeyIds.includes(data.PII_ACTIVE_KEY_ID)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PII_ACTIVE_KEY_ID"],
          message: `PII_ACTIVE_KEY_ID "${data.PII_ACTIVE_KEY_ID}" is not present in PII_KEYS`,
        })
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

/** Exported for unit testing only — use `env` for runtime access. */
export const _envSchema = schema

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
