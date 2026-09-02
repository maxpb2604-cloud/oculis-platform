import type { NextRequest } from "next/server";
import { getOfficialDocumentForOpen } from "@/lib/data";
import { createOfficialDocumentOpenHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handleOfficialDocumentOpen = createOfficialDocumentOpenHandler({
  lookupDocument: getOfficialDocumentForOpen,
});

/** Probe an allowlisted official bill PDF before sending the user to its source URL. */
export async function GET(request: NextRequest): Promise<Response> {
  return handleOfficialDocumentOpen(request);
}
