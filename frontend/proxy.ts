import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_PREFIXES = ['/dashboard', '/onboarding']
const AUTH_ROUTES        = ['/', '/sign-in']

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

  if (isAuthRoute && token) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  if (pathname === '/sign-up' && token && !request.cookies.get('inSignUpFlow')?.value) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  const TOKEN_REQUIRED_ROUTES = ['/verify-email', '/reset-password', '/confirm-email-change']
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