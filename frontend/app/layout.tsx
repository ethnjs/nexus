import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next';
import './globals.css'

export const metadata: Metadata = {
  title: 'NEXUS',
  description: 'Tournament Logistics Dashboard for Science Olympiad',
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
}

export default function RootLayout({children,}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}