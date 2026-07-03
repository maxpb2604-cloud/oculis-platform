import { redirect } from "next/navigation";
import { langQuery, type Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** Legacy English route — the regulatory module ships at /regulatorio. */
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  redirect(`/regulatorio${langQuery(lang)}`);
}
