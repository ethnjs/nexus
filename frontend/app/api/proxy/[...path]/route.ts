import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

const API_URL = process.env.API_URL   ?? 'http://localhost:8001'
const API_KEY = process.env.API_KEY   ?? ''

async function proxy(
  req: NextRequest,
  pathSegments: string[],
  method: string,
): Promise<NextResponse> {
  const path   = pathSegments.join('/')
  const search = req.nextUrl.search

  const cookieStore = await cookies()
  const token = cookieStore.get('access_token')?.value

  const upstream = await fetch(`${API_URL}/${path}${search}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
      // Forward the JWT cookie to the backend as a Cookie header
      ...(token ? { Cookie: `access_token=${token}` } : {}),
    },
    body: method !== 'GET' && method !== 'DELETE'
      ? await req.text()
      : undefined,
  })

  // Forward the raw body
  const body = upstream.status === 204 ? null : await upstream.text()

  const res = new NextResponse(body, { status: upstream.status })

  // Forward any Set-Cookie headers from the backend (login / logout)
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      res.headers.append('Set-Cookie', value)
    }
  })

  res.headers.set('Content-Type', 'application/json')

  return res
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  return proxy(req, path, 'GET')
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  return proxy(req, path, 'POST')
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  return proxy(req, path, 'PATCH')
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  return proxy(req, path, 'DELETE')
}