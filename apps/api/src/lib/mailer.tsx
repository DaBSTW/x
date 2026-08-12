import nodemailer, { type Transporter } from 'nodemailer'
import { renderToStaticMarkup } from 'react-dom/server'
import { Resend } from 'resend'
import { PasswordResetEmail } from '../emails/password-reset-email.js'
import { SecurityAlertEmail } from '../emails/security-alert-email.js'
import { VerificationEmail } from '../emails/verification-email.js'

export type SecurityAlertKind = 'new_login' | 'password_changed' | 'two_factor_enabled'

export type Mailer = {
  sendVerificationEmail: (to: string, token: string) => Promise<void>
  sendPasswordResetEmail: (to: string, token: string) => Promise<void>
  /**
   * SPECS.md §13.2: "no son desactivables" — this never checks a
   * notification preference because it isn't routed through the
   * notifications system at all; there's no preference to check.
   */
  sendSecurityAlertEmail: (
    to: string,
    kind: SecurityAlertKind,
    meta: { ipAddress: string | null; userAgent: string | null },
  ) => Promise<void>
}

// Structurally compatible with both Fastify's `app.log` and a bare pino
// instance — the mailer doesn't need the full logger surface.
export type MailerLogger = {
  warn: (obj: Record<string, unknown>, message: string) => void
}

export type CreateMailerOptions = {
  host: string
  port: number
  from: string
  webUrl: string
  logger: MailerLogger
  /**
   * Resend (ROADMAP.md 2.9) — optional, same posture as VAPID_PUBLIC_KEY in
   * env.ts: unset means every send falls back to the SMTP transport below
   * (Mailpit locally and in every *.integration.test.ts/e2e run, whatever
   * real SMTP relay is configured elsewhere) instead of failing to boot or
   * needing a live Resend account to run the test suite at all.
   */
  resendApiKey?: string
}

const SECURITY_ALERT_COPY: Record<SecurityAlertKind, { subject: string; heading: string }> = {
  new_login: {
    subject: 'Nuevo inicio de sesión en tu cuenta de X',
    heading: 'Nuevo inicio de sesión',
  },
  password_changed: {
    subject: 'Se cambió la contraseña de tu cuenta de X',
    heading: 'Contraseña actualizada',
  },
  two_factor_enabled: {
    subject: 'Activaste la verificación en dos pasos en tu cuenta de X',
    heading: 'Verificación en dos pasos activada',
  },
}

/**
 * Transactional email sender. Delivery is best-effort: a failed send never
 * fails the request that triggered it, it's logged instead — CODESTYLE.md
 * §8.3, matching sendVerificationEmail's existing posture.
 *
 * HTML bodies are apps/api/src/emails/*.tsx rendered with
 * react-dom/server's renderToStaticMarkup — plain React/JSX, not a
 * third-party email-component package: at the time this was written every
 * @react-email/* package on npm (including the versions this project would
 * have pinned) carried an unexplained "no longer supported, contact npm
 * support" deprecation notice on an otherwise actively-published package,
 * a signal closer to an administrative or security takedown than a normal
 * "renamed, use X instead" deprecation. Safer to own ~80 lines of
 * table-based inline-style JSX than to build on that.
 */
export function createMailer(options: CreateMailerOptions): Mailer {
  const smtpTransport: Transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: false,
  })
  const resend = options.resendApiKey ? new Resend(options.resendApiKey) : null

  async function send(to: string, subject: string, text: string, html: string): Promise<void> {
    try {
      if (resend) {
        await resend.emails.send({ from: options.from, to, subject, html, text })
      } else {
        await smtpTransport.sendMail({ from: options.from, to, subject, text, html })
      }
    } catch (error) {
      options.logger.warn({ error, to }, 'email failed to send')
    }
  }

  return {
    async sendVerificationEmail(to, token) {
      const verifyUrl = `${options.webUrl}/verify-email?token=${encodeURIComponent(token)}`
      await send(
        to,
        'Verifica tu cuenta de X',
        `Verifica tu cuenta: ${verifyUrl}`,
        renderToStaticMarkup(<VerificationEmail verifyUrl={verifyUrl} />),
      )
    },

    async sendPasswordResetEmail(to, token) {
      const resetUrl = `${options.webUrl}/reset-password?token=${encodeURIComponent(token)}`
      await send(
        to,
        'Restablece tu contraseña de X',
        `Restablece tu contraseña: ${resetUrl}\n\nSi no lo pediste tú, ignora este email.`,
        renderToStaticMarkup(<PasswordResetEmail resetUrl={resetUrl} />),
      )
    },

    async sendSecurityAlertEmail(to, kind, meta) {
      const { subject, heading } = SECURITY_ALERT_COPY[kind]
      const context = `IP: ${meta.ipAddress ?? 'desconocida'} · Dispositivo: ${meta.userAgent ?? 'desconocido'}`
      const footer = 'Si no fuiste tú, cambia tu contraseña de inmediato.'
      await send(
        to,
        subject,
        `${heading}\n${context}\n\n${footer}`,
        renderToStaticMarkup(
          <SecurityAlertEmail
            heading={heading}
            ipAddress={meta.ipAddress}
            userAgent={meta.userAgent}
          />,
        ),
      )
    },
  }
}
