import { NextRequest, NextResponse } from 'next/server'
import { safeRedirectPath } from '@/lib/auth'

const PROTECTED_PREFIXES = ['/dashboard', '/onboarding']
const AUTH_ROUTES        = ['/', '/sign-in', '/sign-up']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('access_token')?.value

  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))
  const isAuthRoute  = AUTH_ROUTES.includes(pathname)

  if (isProtected && !token) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Already signed in and hitting /, /sign-in, or /sign-up — bounce onward.
  // Honor ?redirect= (e.g. /sign-in?redirect=/join?code=ABC from the join
  // flow) instead of always landing on /dashboard, so a visitor who's
  // already logged in doesn't lose their destination.
  if (isAuthRoute && token) {
    const redirect = safeRedirectPath(request.nextUrl.searchParams.get('redirect'))
    const target = new URL(redirect ?? '/dashboard', request.nextUrl.origin)
    return NextResponse.redirect(target)
  }

  const TOKEN_REQUIRED_ROUTES = ['/verify-email', '/reset-password', '/confirm-email-change', '/account-setup', '/revert-email-change']
  if (TOKEN_REQUIRED_ROUTES.includes(pathname) && !request.nextUrl.searchParams.get('token')) {
    const url = request.nextUrl.clone()
    url.pathname = token ? '/dashboard' : '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api/).*)',
  ],
}