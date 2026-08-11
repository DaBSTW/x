import nodemailer, { type Transporter } from 'nodemailer'

export type SecurityAlertKind = 'new_login' | 'password_changed'

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
}

/**
 * Transactional email sender. Delivery is best-effort: a failed send never
 * fails the request that triggered it, it's logged instead — CODESTYLE.md
 * §8.3, matching sendVerificationEmail's existing posture.
 */
export function createMailer(options: CreateMailerOptions): Mailer {
  const transport: Transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: false,
  })

  async function send(to: string, subject: string, text: string, html: string): Promise<void> {
    try {
      await transport.sendMail({ from: options.from, to, subject, text, html })
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
        `<p>Verifica tu cuenta: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
      )
    },

    async sendPasswordResetEmail(to, token) {
      const resetUrl = `${options.webUrl}/reset-password?token=${encodeURIComponent(token)}`
      await send(
        to,
        'Restablece tu contraseña de X',
        `Restablece tu contraseña: ${resetUrl}\n\nSi no lo pediste tú, ignora este email.`,
        `<p>Restablece tu contraseña: <a href="${resetUrl}">${resetUrl}</a></p><p>Si no lo pediste tú, ignora este email.</p>`,
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
        `<p><strong>${heading}</strong></p><p>${context}</p><p>${footer}</p>`,
      )
    },
  }
}
