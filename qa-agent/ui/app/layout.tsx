import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'QA Agent - Test Any Web Application',
  description: 'Intelligent QA testing that works like a human tester',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
