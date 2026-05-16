import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { admin, emailOTP, username } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./db/schema";

type Env = {
  DB: D1Database;
  ENVIRONMENT: "development" | "production";
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  ADMIN_USER_IDS?: string;
};

export const createAuth = (env: Env) => {
  const db = drizzle(env.DB);
  const baseURL =
    env.BETTER_AUTH_URL ??
    (env.ENVIRONMENT === "development"
      ? "http://localhost:8787"
      : "https://api.evodo.hwld.dev");
  const adminUserIds =
    env.ADMIN_USER_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  return betterAuth({
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    advanced: {
      crossSubDomainCookies: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 365,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        bio: { type: "string", required: false },
      },
    },
    plugins: [
      passkey({ rpID: "evodo.hwld.dev", rpName: "evodo" }),
      emailOTP({
        async sendVerificationOTP({ email, otp, type }) {
          if (env.ENVIRONMENT === "development") {
            console.log(`[OTP] type=${type} email=${email} code=${otp}`);
            return;
          }
          throw new Error("Production OTP sender not implemented yet");
        },
      }),
      username({ minUsernameLength: 3, maxUsernameLength: 30 }),
      admin({ adminUserIds }),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;
