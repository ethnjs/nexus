import { type NextRequest, NextResponse } from "next/server";
import { safeRedirectPath } from "@/lib/auth";

const API_URL = process.env.API_URL ?? "http://localhost:8001";
const API_KEY = process.env.API_KEY ?? "";

const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/forms"];
const AUTH_ROUTES = ["/", "/sign-in", "/sign-up"];
// A shared form link shows signed-out visitors a sign-in card instead.
const SHARED_FORM_LINK = /^\/forms\/[^/]+\/view\/?$/;
const TOKEN_REQUIRED_ROUTES = [
  "/verify-email",
  "/reset-password",
  "/confirm-email-change",
  "/account-setup",
  "/revert-email-change",
];

function backendHeaders(request: NextRequest): HeadersInit {
  return {
    ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
    Cookie: request.headers.get("cookie") ?? "",
  };
}

// Only a 401 means the session is gone; a backend outage shouldn't sign anyone out.
async function sessionIsDead(request: NextRequest): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/users/me/`, { headers: backendHeaders(request) });
    return res.status === 401;
  } catch {
    return false;
  }
}

// The backend owns the cookie's domain and flags, so its logout response does the clearing.
async function clearSessionCookie(request: NextRequest, response: NextResponse) {
  const res = await fetch(`${API_URL}/auth/logout/`, {
    method: "POST",
    headers: backendHeaders(request),
  }).catch(() => null);
  for (const cookie of res?.headers.getSetCookie() ?? []) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const hasCookie = request.cookies.has("access_token");

  const isProtected =
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) && !SHARED_FORM_LINK.test(pathname);
  if (isProtected && !hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  const missingToken = TOKEN_REQUIRED_ROUTES.includes(pathname) && !searchParams.get("token");
  if (!isAuthRoute && !missingToken) return NextResponse.next();

  // A dead cookie mustn't count as signed in here, or /sign-in bounces straight back
  // to the page that sent the visitor to sign in.
  const sessionDead = hasCookie && (await sessionIsDead(request));
  const signedIn = hasCookie && !sessionDead;

  let response: NextResponse;
  if (isAuthRoute) {
    // Honor ?redirect= (e.g. /sign-in?redirect=/join?code=ABC) so a visitor who's
    // already signed in doesn't lose their destination.
    const redirect = safeRedirectPath(searchParams.get("redirect"));
    response = signedIn
      ? NextResponse.redirect(new URL(redirect ?? "/dashboard", request.nextUrl.origin))
      : NextResponse.next();
  } else {
    const url = request.nextUrl.clone();
    url.pathname = signedIn ? "/dashboard" : "/";
    response = NextResponse.redirect(url);
  }

  return sessionDead ? clearSessionCookie(request, response) : response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/).*)"],
};
