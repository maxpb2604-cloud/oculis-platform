import { NextRequest, NextResponse } from "next/server";

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/;

export function requestId(req: NextRequest): string {
  const supplied = req.headers.get("x-request-id");
  return supplied && REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
}

export function apiError(
  req: NextRequest,
  error: unknown,
  route: string,
): NextResponse<{ error: string; requestId: string }> {
  const id = requestId(req);
  console.error(`[api:${route}:${id}]`, error);
  return NextResponse.json(
    { error: "internal_error", requestId: id },
    { status: 500, headers: { "cache-control": "no-store", "x-request-id": id } },
  );
}

export const PRIVATE_READ_CACHE =
  "private, max-age=0, must-revalidate";
