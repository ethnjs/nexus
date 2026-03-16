import { NextRequest, NextResponse } from 'next/server'

const API_URL = process.env.API_URL ?? 'http://localhost:8001'
const API_KEY = process.env.API_KEY ?? ''

async function proxy(
  req: NextRequest,
  pathSegments: string[],
  method: string,
): Promise<NextResponse> {
  const path   = pathSegments.join('/')
  const search = req.nextUrl.search

  // Forward the raw Cookie header from the browser request — simpler and more
  // reliable than reading individual cookies via next/headers
  const cookieHeader = req.headers.get('cookie') ?? ''

  const upstream = await fetch(`${API_URL}/${path}${search}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: method !== 'GET' && method !== 'DELETE'
      ? await req.text()
      : undefined,
  })

  const body = upstream.status === 204 ? null : await upstream.text()

  const res = new NextResponse(body, { status: upstream.status })

  // Forward Set-Cookie headers from backend (login / logout)
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