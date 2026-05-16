import type { Auth } from "./auth";

export type Bindings = {
  DB: D1Database;
  ENVIRONMENT: "development" | "production";
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
};

export type SessionUser = Auth["$Infer"]["Session"]["user"];
export type SessionData = Auth["$Infer"]["Session"]["session"];

export type Variables = {
  user: SessionUser | null;
  session: SessionData | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
