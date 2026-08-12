import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SecurityAlertEmail } from './security-alert-email.js'

describe('SecurityAlertEmail', () => {
  it('renders the heading and the IP/device context', () => {
    const html = renderToStaticMarkup(
      <SecurityAlertEmail
        heading="Nuevo inicio de sesión"
        ipAddress="203.0.113.7"
        userAgent="curl/8.0"
      />,
    )

    expect(html).toMatch(/^<html/)
    expect(html).toContain('Nuevo inicio de sesión')
    expect(html).toContain('203.0.113.7')
    expect(html).toContain('curl/8.0')
    expect(html).toContain('Si no fuiste tú')
  })

  it('falls back to "desconocida"/"desconocido" for a null IP or user agent', () => {
    const html = renderToStaticMarkup(
      <SecurityAlertEmail heading="Contraseña actualizada" ipAddress={null} userAgent={null} />,
    )

    expect(html).toContain('desconocida')
    expect(html).toContain('desconocido')
  })
})
