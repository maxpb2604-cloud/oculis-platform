import "server-only";

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { bootstrapAdminPortalUser, getPortalUserByEmail, getPortalUserById } from "@/lib/data";

export const ADMIN_SESSION_COOKIE = "oculis_admin_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const PASSWORD_KEY_LENGTH = 64;

export interface AdminSession {
  userId: number;
  email: string;
  displayName: string;
  expiresAt: number;
}

interface SessionPayload {
  sub: number;
  email: string;
  exp: number;
}

const developmentSecrets = globalThis as typeof globalThis & {
  __oculisDevelopmentSessionSecret?: string;
};

function sessionSecret(): string {
  const configured = process.env.OCULIS_SESSION_SECRET?.trim();
  if (configured) {
    if (configured.length < 32)
      throw new Error("OCULIS_SESSION_SECRET must contain 32+ characters");
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("OCULIS_SESSION_SECRET is required for the administrative portal");
  }
  if (!developmentSecrets.__oculisDevelopmentSessionSecret) {
    developmentSecrets.__oculisDevelopmentSessionSecret = randomBytes(48).toString("base64url");
  }
  return developmentSecrets.__oculisDevelopmentSessionSecret;
}

function signature(encodedPayload: string): string {
  return createHmac("sha256", sessionSecret()).update(encodedPayload).digest("base64url");
}

export function hashPortalPassword(password: string): string {
  if (password.length < 12 || password.length > 256) {
    throw new Error("password must contain between 12 and 256 characters");
  }
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPortalPassword(password: string, stored: string): boolean {
  const [algorithm, n, r, p, saltValue, hashValue] = stored.split("$");
  if (
    algorithm !== "scrypt" ||
    n !== "16384" ||
    r !== "8" ||
    p !== "1" ||
    !saltValue ||
    !hashValue ||
    password.length > 256
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    if (expected.length !== PASSWORD_KEY_LENGTH || salt.length !== 16) return false;
    const actual = scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 32 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createAdminSessionToken(
  session: Omit<AdminSession, "expiresAt">,
  now = Math.floor(Date.now() / 1000),
): string {
  const payload: SessionPayload = {
    sub: session.userId,
    email: session.email.trim().toLowerCase(),
    exp: now + SESSION_DURATION_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyAdminSessionToken(token: string, now = Math.floor(Date.now() / 1000)) {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expected = Buffer.from(signature(encoded), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    if (
      !Number.isSafeInteger(payload.sub) ||
      Number(payload.sub) <= 0 ||
      typeof payload.email !== "string" ||
      !Number.isSafeInteger(payload.exp) ||
      Number(payload.exp) <= now
    ) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

async function bootstrapConfiguredAdmin(email: string) {
  const configuredEmail = process.env.OCULIS_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const configuredPassword = process.env.OCULIS_BOOTSTRAP_ADMIN_PASSWORD;
  if (!configuredEmail || !configuredPassword || email !== configuredEmail) return null;
  const displayName = process.env.OCULIS_BOOTSTRAP_ADMIN_NAME?.trim() || "Equipo FHC";
  return bootstrapAdminPortalUser({
    email: configuredEmail,
    displayName,
    passwordHash: hashPortalPassword(configuredPassword),
  });
}

export async function authenticateAdmin(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  let user = await getPortalUserByEmail(normalizedEmail);
  if (!user) user = await bootstrapConfiguredAdmin(normalizedEmail);
  if (
    !user ||
    user.role !== "ADMIN" ||
    !user.active ||
    !user.passwordHash ||
    !verifyPortalPassword(password, user.passwordHash)
  ) {
    return null;
  }
  return { userId: user.id, email: user.email, displayName: user.displayName };
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  let payload: SessionPayload | null = null;
  try {
    payload = verifyAdminSessionToken(token);
  } catch {
    return null;
  }
  if (!payload) return null;
  const user = await getPortalUserById(payload.sub);
  if (
    !user ||
    !user.active ||
    user.role !== "ADMIN" ||
    user.email.toLowerCase() !== payload.email
  ) {
    return null;
  }
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    expiresAt: payload.exp,
  };
}

export const adminSessionCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DURATION_SECONDS,
};
