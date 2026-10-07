import type { MetadataRoute } from 'next'

// Hace que Chrome en Android ofrezca "Instalar app" y la abra a pantalla completa
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TraderCat',
    short_name: 'TraderCat',
    description: 'Seguimiento y control de activos bursátiles',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#050505',
    theme_color: '#050505',
    lang: 'es',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}