import type { Metadata, Viewport } from 'next'
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
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
}

// Color de la barra del navegador en el celular y ajuste de pantalla
export const viewport: Viewport = {
  themeColor: '#050505',
  width: 'device-width',
  initialScale: 1,
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