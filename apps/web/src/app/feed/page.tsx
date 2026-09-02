import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { CongressMovements } from "@/components/congress-movements";
import { getCongressMovementDay, todayISO, type CongressMovementChamber } from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { isISODate } from "@/lib/input";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Movimientos del Congreso",
        description:
          "Archivo diario de depósitos y movimientos oficiales de iniciativas en la Cámara de Diputados y el Senado de la República.",
      }
    : {
        title: "Congressional movements",
        description:
          "A daily archive of source-dated initiative filings and official movements in the Chamber of Deputies and Senate of the Republic.",
      };
}

function movementChamber(value: string | undefined): CongressMovementChamber {
  return value === "SENADO" ? "SENADO" : "DIPUTADOS";
}

export default async function FeedPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const lang: Lang = parseLang(sp.lang);
  const chamber = movementChamber(sp.chamber);
  const requestedDate = isISODate(sp.date) ? sp.date : undefined;
  const day = await getCongressMovementDay({ date: requestedDate, chamber });
  const today = todayISO();

  return (
    <AppShell
      lang={lang}
      title={lang === "es" ? "Movimientos del Congreso" : "Congressional movements"}
      subtitle={
        lang === "es"
          ? "Qué ocurrió con cada iniciativa, día por día, según las fechas y documentos publicados por las fuentes oficiales."
          : "What happened to each initiative, day by day, based on dates and documents published by official sources."
      }
    >
      <CongressMovements day={day} lang={lang} today={today} />
    </AppShell>
  );
}
