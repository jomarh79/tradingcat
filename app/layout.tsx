import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { PrivacyProvider } from '../lib/PrivacyContext'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'TraderCat',
    template: '%s · TraderCat',
  },
  description: 'Seguimiento y control de activos bursátiles',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className={inter.className}>
        <PrivacyProvider>
          {children}
        </PrivacyProvider>
      </body>
    </html>
  )
}