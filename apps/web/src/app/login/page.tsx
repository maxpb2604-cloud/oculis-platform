import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { parseLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Iniciar sesión",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; error?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (parseLang(params.lang) === "en") query.set("lang", "en");
  if (params.error === "1" || params.error === "unavailable" || params.error === "limited") {
    query.set("error", params.error);
  }
  redirect(`/${query.size ? `?${query}` : ""}#acceso`);
}
