import { drizzle } from "drizzle-orm/d1";
import { desc, eq } from "drizzle-orm";

import * as schema from "../src/db/schema";

/**
 * Better Auth の verification テーブルから、指定 email と type の最新 OTP を取得する。
 * Better Auth は `<otp>:<attempts>` 形式で plaintext 保存している。
 */
export const getOtpForEmail = async (
  db: D1Database,
  email: string,
  type: "sign-in" | "email-verification" | "forget-password" = "sign-in",
): Promise<string> => {
  const drz = drizzle(db, { schema });
  const row = await drz
    .select({ value: schema.verification.value })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, `${type}-otp-${email}`))
    .orderBy(desc(schema.verification.createdAt))
    .limit(1)
    .get();
  if (!row) throw new Error(`no verification row for ${email}`);
  const otp = row.value.split(":")[0];
  if (!/^\d+$/.test(otp))
    throw new Error(`OTP value not numeric: ${row.value}`);
  return otp;
};

/**
 * 各テスト前に auth 系テーブルを空にする。
 * 外部キーがあるので子テーブルから削除する。
 */
export const cleanAuthTables = async (db: D1Database): Promise<void> => {
  await db.batch([
    db.prepare("DELETE FROM passkey"),
    db.prepare("DELETE FROM session"),
    db.prepare("DELETE FROM account"),
    db.prepare("DELETE FROM verification"),
    db.prepare("DELETE FROM user"),
  ]);
};
