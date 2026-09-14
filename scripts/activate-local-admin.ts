/** Provision an administrator in an existing local PGlite snapshot.
 *
 * Supply the password as one line on stdin. It is never accepted as a command-line
 * argument or written to the repository. This intentionally cannot touch cloud DBs.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";
import { createDb } from "@oculis/db";
import { portalUsers } from "@oculis/db/schema";

const email = process.env.OCULIS_ADMIN_ACTIVATION_EMAIL?.trim().toLowerCase();
if (
  !email ||
  !email.includes("@") ||
  !process.env.PGLITE_DIR ||
  process.env.DATABASE_URL ||
  process.env.DB_DRIVER !== "pglite"
) {
  throw new Error("Local activation requires an email, DB_DRIVER=pglite, and PGLITE_DIR; DATABASE_URL must be unset.");
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const password = await new Promise<string>((resolve, reject) => {
  lines.once("line", resolve);
  lines.once("close", () => reject(new Error("A password line is required on stdin.")));
});
lines.close();
if (password.length < 12 || password.length > 256) {
  throw new Error("Administrator password must contain 12–256 characters.");
}

const salt = randomBytes(16);
const derived = scryptSync(password, salt, 64, {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
});
const passwordHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;

const handle = createDb();
try {
  const [created] = await handle.db
    .insert(portalUsers)
    .values({
      email,
      displayName: "Max Peña",
      passwordHash,
      role: "ADMIN",
      active: true,
    })
    .onConflictDoNothing()
    .returning({ id: portalUsers.id });
  if (!created) {
    throw new Error("An account with this email already exists; no account was changed.");
  }
  process.stdout.write("Local administrator account activated.\n");
} finally {
  await handle.close();
}
