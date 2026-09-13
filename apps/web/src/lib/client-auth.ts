import "server-only";

import { cookies } from "next/headers";
import {
  adminSessionCookieOptions,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "@/lib/admin-auth";
import { getActivePortalClientById, getPortalUserByEmail, getPortalUserById } from "@/lib/data";
import { verifyPortalPassword } from "@/lib/admin-auth";

export const CLIENT_SESSION_COOKIE = "oculis_client_session";
export const clientSessionCookieOptions = adminSessionCookieOptions;
export const createClientSessionToken = createAdminSessionToken;

export async function authenticateClient(email: string, password: string) {
  const user = await getPortalUserByEmail(email);
  if (
    !user ||
    user.role !== "CLIENT" ||
    !user.active ||
    !user.clientId ||
    !user.passwordHash ||
    !verifyPortalPassword(password, user.passwordHash)
  )
    return null;
  const client = await getActivePortalClientById(user.clientId);
  if (!client) return null;
  return { userId: user.id, email: user.email, displayName: user.displayName };
}

export async function getClientSession() {
  const token = (await cookies()).get(CLIENT_SESSION_COOKIE)?.value;
  if (!token) return null;
  let payload: ReturnType<typeof verifyAdminSessionToken>;
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
    user.role !== "CLIENT" ||
    !user.clientId ||
    user.email.toLowerCase() !== payload.email
  )
    return null;
  const client = await getActivePortalClientById(user.clientId);
  if (!client) return null;
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    client,
    expiresAt: payload.exp,
  };
}
