import { redirect } from "next/navigation";

/** Legacy dashboard route: keep old bookmarks working without maintaining a duplicate home. */
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang = (await searchParams).lang === "en" ? "?lang=en" : "";
  redirect(`/${lang}`);
}
