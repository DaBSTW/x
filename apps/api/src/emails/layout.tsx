import type { ReactNode } from 'react'

// Table-based layout, inline styles only — no <style> tag, no flexbox/grid:
// the traditional email-safe subset most clients (notably Outlook, which
// renders HTML email with a Word engine) actually support consistently.
const CONTAINER_STYLE = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  maxWidth: '480px',
  margin: '0 auto',
  padding: '32px 24px',
  color: '#0f172a',
  backgroundColor: '#ffffff',
}

const BUTTON_STYLE = {
  display: 'inline-block',
  backgroundColor: '#2b62ef',
  color: '#ffffff',
  textDecoration: 'none',
  padding: '12px 24px',
  borderRadius: '8px',
  fontWeight: 600,
  marginTop: '16px',
}

const FOOTER_STYLE = {
  marginTop: '32px',
  paddingTop: '16px',
  borderTop: '1px solid #e2e8f0',
  fontSize: '12px',
  color: '#64748b',
}

/** Shared chrome for every transactional email (ROADMAP.md 2.9) — apps/api's own JSX->HTML, not a third-party email-component library (see mailer.ts's note on why). */
export function EmailLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ backgroundColor: '#f8fafc', margin: 0, padding: '24px 0' }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            <tr>
              <td>
                <table
                  role="presentation"
                  align="center"
                  style={CONTAINER_STYLE}
                  cellPadding={0}
                  cellSpacing={0}
                >
                  <tbody>
                    <tr>
                      <td style={{ fontSize: '20px', fontWeight: 700, paddingBottom: '24px' }}>
                        X
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontSize: '15px', lineHeight: 1.6 }}>{children}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}

export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} style={BUTTON_STYLE}>
      {children}
    </a>
  )
}

export function EmailFooter({ children }: { children: ReactNode }) {
  return <p style={FOOTER_STYLE}>{children}</p>
}
