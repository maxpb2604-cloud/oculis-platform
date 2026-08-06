import { permanentRedirect } from "next/navigation";

/** Backwards-compatible English alias for the canonical Spanish route. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = (await searchParams).lang === "en" ? "?lang=en" : "";
  permanentRedirect(`/regulatorio${lang}`);
}
