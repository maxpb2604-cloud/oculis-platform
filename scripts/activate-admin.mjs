import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const email = process.env.OCULIS_ADMIN_ACTIVATION_EMAIL?.trim().toLowerCase();
const password = process.env.OCULIS_ADMIN_ACTIVATION_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (!email || !email.includes("@") || !password || password.length < 12 || password.length > 256 || !databaseUrl) {
  throw new Error("Administrator activation requires an email, a 12–256 character password, and DATABASE_URL.");
}

const salt = randomBytes(16);
const derived = scryptSync(password, salt, 64, {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
});
const passwordHash = `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });

try {
  const result = await pool.query(
    `INSERT INTO portal_users (email, display_name, password_hash, role, active)
     VALUES ($1, $2, $3, 'ADMIN', true)
     ON CONFLICT (lower(email)) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           active = true,
           updated_at = now()
     WHERE portal_users.role = 'ADMIN' AND portal_users.client_id IS NULL
     RETURNING id, role, active`,
    [email, "Max Peña", passwordHash],
  );
  if (result.rowCount !== 1 || result.rows[0]?.role !== "ADMIN" || !result.rows[0]?.active) {
    throw new Error("The email is assigned to a non-administrator account; no account was changed.");
  }
  process.stdout.write("Administrator account activated.\n");
} finally {
  await pool.end();
}
