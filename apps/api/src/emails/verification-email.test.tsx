import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VerificationEmail } from './verification-email.js'

describe('VerificationEmail', () => {
  it('renders valid HTML carrying the verify URL as a link and as visible text', () => {
    const html = renderToStaticMarkup(
      <VerificationEmail verifyUrl="https://x.example.com/verify-email?token=abc123" />,
    )

    expect(html).toMatch(/^<html/)
    expect(html).toContain('href="https://x.example.com/verify-email?token=abc123"')
    expect(html).toContain('https://x.example.com/verify-email?token=abc123')
    expect(html).toContain('Verificar mi cuenta')
  })
})
