import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PasswordResetEmail } from './password-reset-email.js'

describe('PasswordResetEmail', () => {
  it('renders valid HTML carrying the reset URL and the "not you" disclaimer', () => {
    const html = renderToStaticMarkup(
      <PasswordResetEmail resetUrl="https://x.example.com/reset-password?token=xyz789" />,
    )

    expect(html).toMatch(/^<html/)
    expect(html).toContain('href="https://x.example.com/reset-password?token=xyz789"')
    expect(html).toContain('Restablecer contraseña')
    expect(html).toContain('Si no lo pediste tú')
  })
})
