"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Buildings,
  List,
  Plus,
  ShieldCheck,
  SignOut,
  UserPlus,
  UsersThree,
} from "@/components/ui/icons";
import type { Lang } from "@/lib/i18n";

interface ClientUser {
  id: number;
  email: string;
  displayName: string;
  active: boolean;
  activationPending: boolean;
}

interface ClientAssignment {
  id: number;
  kind: "LEGISLATIVE" | "REGULATORY";
  recordId: number;
  code: string | null;
  institution: string | null;
  title: string;
  impactOnBusiness: string;
  executiveSupport: string;
  keyStakeholderSupport: string;
  publicOpinion: string;
  internalNote: string | null;
  updatedAt: string;
}

interface ClientSummary {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  users: ClientUser[];
  assignments: ClientAssignment[];
}

interface AdminUser {
  id: number;
  email: string;
  displayName: string;
  active: boolean;
  activationPending: boolean;
}

const impactLabels = {
  es: { HIGH: "Alto", MEDIUM: "Medio", LOW: "Bajo", TO_ASSESS: "Por evaluar" },
  en: { HIGH: "High", MEDIUM: "Medium", LOW: "Low", TO_ASSESS: "To assess" },
} as const;

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(result.error || "No se pudo completar la solicitud.");
}

export function AdminClientManager({
  adminUsers,
  clients,
  adminName,
  adminEmail,
  lang,
}: {
  adminUsers: AdminUser[];
  clients: ClientSummary[];
  adminName: string;
  adminEmail: string;
  lang: Lang;
}) {
  const router = useRouter();
  const es = lang === "es";
  const [addingClient, setAddingClient] = useState(false);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [addingUserFor, setAddingUserFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function addAdmin(form: FormData) {
    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/admin/users", {
        displayName: String(form.get("displayName") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      setAddingAdmin(false);
      setMessage({
        tone: "ok",
        text: es ? "Administrador de FHC agregado." : "FHC administrator added.",
      });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function addClient(form: FormData) {
    setBusy(true);
    setMessage(null);
    try {
      await postJson("/api/admin/clients", { name: String(form.get("name") ?? "") });
      setAddingClient(false);
      setMessage({ tone: "ok", text: es ? "Cliente creado." : "Client created." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function addUser(clientId: number, form: FormData) {
    setBusy(true);
    setMessage(null);
    try {
      await postJson(`/api/admin/clients/${clientId}/users`, {
        displayName: String(form.get("displayName") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      setAddingUserFor(null);
      setMessage({
        tone: "ok",
        text: es ? "Usuario autorizado agregado." : "Authorized user added.",
      });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    window.location.assign(`/admin/login${lang === "en" ? "?lang=en" : ""}`);
  }

  return (
    <div data-testid="admin-client-manager">
      <section
        aria-labelledby="admin-access-title"
        className="rounded-[var(--radius-lg)] border bg-[var(--surface)] p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="eyebrow text-[var(--accent)]">
              {es ? "Equipo Ferdinand Herrera" : "Ferdinand Herrera team"}
            </p>
            <h2 id="admin-access-title" className="section-title mt-2">
              {es ? "Accesos de administradores" : "Administrator access"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">
              {es
                ? "Estas cuentas pueden gestionar clientes, crear accesos y asignar iniciativas. Son independientes de las cuentas de cada cliente."
                : "These accounts can manage clients, create access, and assign initiatives. They are separate from each client's accounts."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAddingAdmin((value) => !value)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:opacity-90"
            >
              <UserPlus size={17} aria-hidden="true" />
              {es ? "Agregar administrador" : "Add administrator"}
            </button>
            <button type="button" onClick={signOut} className="ui-button min-h-11 gap-2 px-4 text-sm">
              <SignOut size={17} aria-hidden="true" />
              {es ? "Cerrar sesión" : "Sign out"}
            </button>
          </div>
        </div>
        <p className="mt-4 text-xs text-[var(--text-muted)]">
          {es ? `Sesión iniciada como ${adminName} (${adminEmail}).` : `Signed in as ${adminName} (${adminEmail}).`}
        </p>
        <ul className="mt-5 divide-y rounded-lg border" role="list">
          {adminUsers.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <ShieldCheck size={21} aria-hidden="true" className="shrink-0 text-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{user.displayName}</div>
                <div className="break-all text-xs text-[var(--text-muted)]">{user.email}</div>
              </div>
              {user.email.toLowerCase() === adminEmail.toLowerCase() ? (
                <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]">
                  {es ? "Tu cuenta" : "Your account"}
                </span>
              ) : null}
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${user.active && !user.activationPending ? "bg-[var(--verified-soft)] text-[var(--verified)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"}`}
              >
                {!user.active
                  ? es ? "Inactivo" : "Inactive"
                  : user.activationPending
                    ? es ? "Pendiente de activación" : "Activation pending"
                    : es ? "Activo" : "Active"}
              </span>
            </li>
          ))}
        </ul>
        {addingAdmin ? (
          <form action={addAdmin} className="mt-5 grid gap-3 rounded-lg border bg-[var(--surface-2)] p-4 sm:grid-cols-2">
            <div>
              <label htmlFor="admin-name" className="mb-1.5 block text-xs font-semibold">
                {es ? "Nombre del administrador" : "Administrator name"}
              </label>
              <input id="admin-name" name="displayName" required minLength={2} maxLength={100} className="ui-input w-full" />
            </div>
            <div>
              <label htmlFor="admin-email" className="mb-1.5 block text-xs font-semibold">
                {es ? "Correo del administrador" : "Administrator email"}
              </label>
              <input id="admin-email" name="email" type="email" required maxLength={254} className="ui-input w-full" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="admin-password" className="mb-1.5 block text-xs font-semibold">
                {es ? "Contraseña inicial" : "Initial password"}
              </label>
              <input
                id="admin-password"
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                className="ui-input w-full"
                aria-describedby="admin-password-help"
              />
              <p id="admin-password-help" className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                {es
                  ? "Mínimo 12 caracteres. Compártala por un canal seguro: Oculis no podrá mostrarla después."
                  : "Minimum 12 characters. Share it through a secure channel: Oculis cannot display it later."}
              </p>
            </div>
            <button disabled={busy} className="min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">
              {busy ? (es ? "Guardando…" : "Saving…") : es ? "Guardar administrador" : "Save administrator"}
            </button>
          </form>
        ) : null}
      </section>

      {message ? (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={`mt-5 rounded-lg border px-4 py-3 text-sm ${message.tone === "error" ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]" : "border-[var(--verified)] bg-[var(--verified-soft)] text-[var(--verified)]"}`}
        >
          {message.text}
        </div>
      ) : null}

      <section aria-label={es ? "Resumen de clientes" : "Client overview"} className="mt-8 grid gap-4 border-b pb-7 sm:grid-cols-3">
        <AdminStat
          icon={<Buildings size={20} aria-hidden="true" />}
          value={clients.length}
          label={es ? "Clientes" : "Clients"}
        />
        <AdminStat
          icon={<UsersThree size={20} aria-hidden="true" />}
          value={clients.reduce((sum, client) => sum + client.users.length, 0)}
          label={es ? "Usuarios de clientes" : "Client users"}
        />
        <AdminStat
          icon={<List size={20} aria-hidden="true" />}
          value={clients.reduce((sum, client) => sum + client.assignments.length, 0)}
          label={es ? "Iniciativas asignadas" : "Assigned initiatives"}
        />
      </section>

      <section aria-labelledby="client-access-title" className="mt-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-[var(--accent)]">
            {es ? "Cartera de clientes" : "Client portfolio"}
          </p>
          <h2 id="client-access-title" className="section-title mt-2">{es ? "Accesos de clientes" : "Client access"}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">
            {es
              ? "Cada cliente reúne sus usuarios autorizados y las iniciativas que FHC ha marcado como relevantes para su organización."
              : "Each client contains its authorized users and the initiatives FHC has marked as relevant to that organization."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAddingClient((value) => !value)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            <Plus size={17} weight="bold" aria-hidden="true" />
            {es ? "Agregar cliente" : "Add client"}
          </button>
        </div>
      </div>

      {addingClient ? (
        <form
          action={addClient}
          className="mt-5 grid gap-3 rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        >
          <div>
            <label htmlFor="new-client-name" className="mb-2 block text-sm font-semibold">
              {es ? "Nombre del nuevo cliente" : "New client name"}
            </label>
            <input
              id="new-client-name"
              name="name"
              required
              minLength={2}
              maxLength={120}
              className="ui-input w-full"
              placeholder={es ? "Ej.: Philip Morris Dominicana" : "e.g. Philip Morris Dominicana"}
            />
          </div>
          <button
            disabled={busy}
            className="min-h-11 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? (es ? "Guardando…" : "Saving…") : es ? "Crear cliente" : "Create client"}
          </button>
        </form>
      ) : null}

      {clients.length ? (
        <div className="mt-6 grid items-start gap-5 xl:grid-cols-2">
          {clients.map((client) => (
            <article
              key={client.id}
              className="overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--surface)] shadow-sm"
            >
              <header className="flex items-start justify-between gap-4 border-b bg-[var(--surface-2)] px-5 py-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[var(--accent)]">
                    <Briefcase size={19} weight="fill" aria-hidden="true" />
                    <span className="eyebrow">{es ? "Cliente" : "Client"}</span>
                  </div>
                  <h3 className="mt-2 truncate text-xl font-semibold">{client.name}</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{client.slug}</p>
                </div>
                <span className="rounded-full bg-[var(--verified-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--verified)]">
                  {es ? "Activo" : "Active"}
                </span>
              </header>

              <section className="px-5 py-5" aria-labelledby={`client-${client.id}-users`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 id={`client-${client.id}-users`} className="font-semibold">
                      {es ? "Usuarios autorizados" : "Authorized users"}
                    </h4>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {client.users.length} {es ? "cuentas registradas" : "registered accounts"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAddingUserFor(addingUserFor === client.id ? null : client.id)}
                    className="ui-button min-h-10 gap-2 px-3 text-xs"
                  >
                    <UserPlus size={16} aria-hidden="true" />
                    {es ? "Agregar usuario" : "Add user"}
                  </button>
                </div>

                {addingUserFor === client.id ? (
                  <form
                    action={(form) => addUser(client.id, form)}
                    className="mt-4 grid gap-3 rounded-lg border bg-[var(--surface-2)] p-3 sm:grid-cols-2"
                  >
                    <div>
                      <label
                        htmlFor={`user-name-${client.id}`}
                        className="mb-1.5 block text-xs font-semibold"
                      >
                        {es ? "Nombre" : "Name"}
                      </label>
                      <input
                        id={`user-name-${client.id}`}
                        name="displayName"
                        required
                        minLength={2}
                        maxLength={100}
                        className="ui-input w-full"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`user-email-${client.id}`}
                        className="mb-1.5 block text-xs font-semibold"
                      >
                        {es ? "Correo" : "Email"}
                      </label>
                      <input
                        id={`user-email-${client.id}`}
                        name="email"
                        type="email"
                        required
                        maxLength={254}
                        className="ui-input w-full"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label
                        htmlFor={`user-password-${client.id}`}
                        className="mb-1.5 block text-xs font-semibold"
                      >
                        {es ? "Contraseña temporal" : "Temporary password"}
                      </label>
                      <input
                        id={`user-password-${client.id}`}
                        name="password"
                        type="password"
                        required
                        minLength={12}
                        maxLength={256}
                        autoComplete="new-password"
                        className="ui-input w-full"
                        aria-describedby={`user-password-help-${client.id}`}
                      />
                      <p
                        id={`user-password-help-${client.id}`}
                        className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]"
                      >
                        {es
                          ? "Mínimo 12 caracteres. Se cifra al guardar y no podrá volver a consultarse."
                          : "Minimum 12 characters. It is hashed when saved and cannot be viewed again."}
                      </p>
                    </div>
                    <button
                      disabled={busy}
                      className="min-h-10 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-white disabled:opacity-50 sm:col-span-2"
                    >
                      {busy
                        ? es
                          ? "Guardando…"
                          : "Saving…"
                        : es
                          ? "Guardar usuario"
                          : "Save user"}
                    </button>
                  </form>
                ) : null}

                <ul className="mt-4 divide-y rounded-lg border" role="list">
                  {client.users.length ? (
                    client.users.map((user) => (
                      <li
                        key={user.id}
                        className="flex items-center justify-between gap-3 px-3 py-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{user.displayName}</div>
                          <div className="truncate text-xs text-[var(--text-muted)]">
                            {user.email}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${user.activationPending ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--verified-soft)] text-[var(--verified)]"}`}
                        >
                          {user.activationPending
                            ? es
                              ? "Pendiente de activación"
                              : "Activation pending"
                            : es
                              ? "Activo"
                              : "Active"}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-5 text-center text-xs text-[var(--text-muted)]">
                      {es ? "Aún no hay usuarios autorizados." : "No authorized users yet."}
                    </li>
                  )}
                </ul>
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                  {es
                    ? "Por seguridad, Oculis nunca muestra ni guarda contraseñas en texto legible. El cliente puede iniciar sesión desde la portada con su cuenta autorizada."
                    : "For security, Oculis never displays or stores readable passwords. Clients can sign in from the homepage with their authorized account."}
                </p>
              </section>

              <section
                className="border-t px-5 py-5"
                aria-labelledby={`client-${client.id}-assignments`}
              >
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h4 id={`client-${client.id}-assignments`} className="font-semibold">
                      {es ? "Iniciativas asignadas" : "Assigned initiatives"}
                    </h4>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {client.assignments.length}{" "}
                      {es ? "marcadas como relevantes" : "marked as relevant"}
                    </p>
                  </div>
                  <Link
                    href={`/feed${lang === "en" ? "?lang=en" : ""}`}
                    className="text-xs font-semibold text-[var(--accent)] underline-offset-4 hover:underline"
                  >
                    {es ? "Asignar desde movimientos" : "Assign from movements"}
                  </Link>
                </div>
                <ul className="mt-4 space-y-2" role="list">
                  {client.assignments.length ? (
                    client.assignments.slice(0, 6).map((assignment) => (
                      <li key={assignment.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                            {assignment.kind === "LEGISLATIVE"
                              ? es
                                ? "Legislativa"
                                : "Legislative"
                              : es
                                ? "Regulatoria"
                                : "Regulatory"}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {assignment.code ?? assignment.institution}
                          </span>
                          <span className="ml-auto text-[10px] font-semibold text-[var(--warn)]">
                            {es ? "Impacto" : "Impact"}:{" "}
                            {impactLabels[lang][
                              assignment.impactOnBusiness as keyof (typeof impactLabels)["es"]
                            ] ?? assignment.impactOnBusiness}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug">
                          {assignment.title}
                        </p>
                      </li>
                    ))
                  ) : (
                    <li className="rounded-lg border border-dashed px-3 py-5 text-center text-xs text-[var(--text-muted)]">
                      {es
                        ? "Aún no se han asignado iniciativas a este cliente."
                        : "No initiatives have been assigned to this client yet."}
                    </li>
                  )}
                </ul>
              </section>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-[var(--radius-lg)] border border-dashed bg-[var(--surface)] px-6 py-14 text-center">
          <Buildings size={30} aria-hidden="true" className="mx-auto text-[var(--text-muted)]" />
          <h3 className="mt-3 text-lg font-semibold">
            {es ? "Agrega el primer cliente" : "Add the first client"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-muted)]">
            {es
              ? "Después podrás registrar sus usuarios y asignarle iniciativas legislativas o regulatorias."
              : "You can then register its users and assign legislative or regulatory initiatives."}
          </p>
        </div>
      )}
      </section>
    </div>
  );
}

function AdminStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 text-[var(--accent)]">
        {icon}
        <span className="eyebrow">{label}</span>
      </div>
      <div className="tnum mt-3 text-3xl font-semibold">{value}</div>
    </div>
  );
}
