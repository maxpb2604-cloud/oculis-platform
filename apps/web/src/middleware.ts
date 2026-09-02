import { NextResponse, type NextRequest } from "next/server";
import { LANG_REQUEST_HEADER, parseLang } from "@/lib/i18n";

/**
 * Expose the URL-selected language to server layouts without changing the public URL.
 * The incoming header is always overwritten so clients cannot spoof layout language.
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LANG_REQUEST_HEADER, parseLang(request.nextUrl.searchParams.get("lang")));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|assets|.*\\..*).*)",
  ],
};
