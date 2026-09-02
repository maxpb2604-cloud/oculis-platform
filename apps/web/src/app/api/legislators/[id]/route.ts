import { NextResponse } from "next/server";
import { getLegislatorProfileById } from "@/lib/data";
import { safeHttpUrl, safeOfficialUrl } from "@/lib/input";
import { parseLegislatorProfileId } from "./input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "cache-control": "private, max-age=300",
  "x-content-type-options": "nosniff",
} as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const url = new URL(request.url);
  if (url.searchParams.size > 0) {
    return jsonError("invalid_request", 400);
  }

  const profileId = parseLegislatorProfileId((await params).id);
  if (profileId == null) {
    return jsonError("invalid_profile_id", 400);
  }

  try {
    const profile = await getLegislatorProfileById(profileId);
    if (!profile) return jsonError("profile_not_found", 404);

    return NextResponse.json(
      {
        profile: {
          ...profile,
          photoUrl: safeHttpUrl(profile.photoUrl),
          sourceUrl: safeOfficialUrl(profile.sourceUrl, profile.source),
        },
      },
      { headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    console.error("Unable to load legislator profile", { profileId, error });
    return jsonError("profile_unavailable", 500);
  }
}

function jsonError(code: string, status: number): NextResponse {
  return NextResponse.json(
    { error: code },
    {
      status,
      headers: {
        ...RESPONSE_HEADERS,
        "cache-control": "no-store",
      },
    },
  );
}
