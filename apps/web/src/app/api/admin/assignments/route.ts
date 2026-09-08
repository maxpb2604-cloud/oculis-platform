import { NextResponse, type NextRequest } from "next/server";
import { adminApiError, authorizedAdminRequest } from "@/lib/admin-api";
import { saveAdminClientAssignment } from "@/lib/data";

const impactValues = new Set(["HIGH", "MEDIUM", "LOW", "TO_ASSESS"]);
const executiveValues = new Set(["SUPPORTS", "NEUTRAL", "OPPOSES", "UNKNOWN"]);
const stakeholderValues = new Set(["SUPPORTS", "MIXED", "OPPOSES", "UNKNOWN"]);
const opinionValues = new Set(["FAVORABLE", "MIXED", "UNFAVORABLE", "UNKNOWN"]);

export async function POST(request: NextRequest) {
  const auth = await authorizedAdminRequest(request);
  if (auth.error) return auth.error;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const clientId = Number(body.clientId);
    const recordId = Number(body.recordId);
    const kind =
      body.kind === "REGULATORY"
        ? "REGULATORY"
        : body.kind === "LEGISLATIVE"
          ? "LEGISLATIVE"
          : null;
    const impactOnBusiness = String(body.impactOnBusiness ?? "");
    const executiveSupport = String(body.executiveSupport ?? "");
    const keyStakeholderSupport = String(body.keyStakeholderSupport ?? "");
    const publicOpinion = String(body.publicOpinion ?? "");
    const internalNote =
      typeof body.internalNote === "string" ? body.internalNote.slice(0, 1_500) : null;
    if (
      !kind ||
      !Number.isSafeInteger(clientId) ||
      clientId <= 0 ||
      !Number.isSafeInteger(recordId) ||
      recordId <= 0 ||
      !impactValues.has(impactOnBusiness) ||
      !executiveValues.has(executiveSupport) ||
      !stakeholderValues.has(keyStakeholderSupport) ||
      !opinionValues.has(publicOpinion)
    ) {
      return NextResponse.json({ error: "Completa todos los campos requeridos." }, { status: 400 });
    }
    const result = await saveAdminClientAssignment({
      clientId,
      record: { kind, recordId },
      impactOnBusiness: impactOnBusiness as "HIGH" | "MEDIUM" | "LOW" | "TO_ASSESS",
      executiveSupport: executiveSupport as "SUPPORTS" | "NEUTRAL" | "OPPOSES" | "UNKNOWN",
      keyStakeholderSupport: keyStakeholderSupport as "SUPPORTS" | "MIXED" | "OPPOSES" | "UNKNOWN",
      publicOpinion: publicOpinion as "FAVORABLE" | "MIXED" | "UNFAVORABLE" | "UNKNOWN",
      internalNote,
      assignedByUserId: auth.session.userId,
    });
    return NextResponse.json({ assignment: result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return adminApiError(error, "No se pudo guardar la asignación.");
  }
}
