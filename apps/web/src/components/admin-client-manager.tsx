"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Buildings,
  List,
  Plus,
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
  clients,
  adminName,
  lang,
}: {
  clients: ClientSummary[];
  adminName: string;
  lang: Lang;
}) {
  const router = useRouter();
  const es = lang === "es";
  const [addingClient, setAddingClient] = useState(false);
  const [addingUserFor, setAddingUserFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

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
      <section className="grid gap-4 border-b pb-7 sm:grid-cols-3">
        <AdminStat
          icon={<Buildings size={20} aria-hidden="true" />}
          value={clients.length}
          label={es ? "Clientes" : "Clients"}
        />
        <AdminStat
          icon={<UsersThree size={20} aria-hidden="true" />}
          value={clients.reduce((sum, client) => sum + client.users.length, 0)}
          label={es ? "Usuarios autorizados" : "Authorized users"}
        />
        <AdminStat
          icon={<List size={20} aria-hidden="true" />}
          value={clients.reduce((sum, client) => sum + client.assignments.length, 0)}
          label={es ? "Iniciativas asignadas" : "Assigned initiatives"}
        />
      </section>

      <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow text-[var(--accent)]">
            {es ? "Cartera de clientes" : "Client portfolio"}
          </p>
          <h2 className="section-title mt-2">{es ? "Clientes y acceso" : "Clients and access"}</h2>
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
          <button type="button" onClick={signOut} className="ui-button min-h-11 gap-2 px-4 text-sm">
            <SignOut size={17} aria-hidden="true" />
            {es ? "Cerrar sesión" : "Sign out"}
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--text-muted)]">
        {es ? `Sesión iniciada como ${adminName}.` : `Signed in as ${adminName}.`}
      </p>

      {message ? (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={`mt-5 rounded-lg border px-4 py-3 text-sm ${message.tone === "error" ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]" : "border-[var(--verified)] bg-[var(--verified-soft)] text-[var(--verified)]"}`}
        >
          {message.text}
        </div>
      ) : null}

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
                    ? "Por seguridad, Oculis nunca muestra ni guarda contraseñas en texto legible. El acceso preparado se utilizará cuando habilitemos el portal del cliente."
                    : "For security, Oculis never displays or stores readable passwords. Prepared access will be used when the client portal is enabled."}
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
