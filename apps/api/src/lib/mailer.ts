import nodemailer, { type Transporter } from 'nodemailer'

export type Mailer = {
  sendVerificationEmail: (to: string, token: string) => Promise<void>
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

/**
 * Transactional email sender. Delivery is best-effort: a failed send never
 * fails registration, it's logged and the user can request a new
 * verification email — CODESTYLE.md §8.3.
 */
export function createMailer(options: CreateMailerOptions): Mailer {
  const transport: Transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: false,
  })

  return {
    async sendVerificationEmail(to, token) {
      const verifyUrl = `${options.webUrl}/verify-email?token=${encodeURIComponent(token)}`

      try {
        await transport.sendMail({
          from: options.from,
          to,
          subject: 'Verifica tu cuenta de X',
          text: `Verifica tu cuenta: ${verifyUrl}`,
          html: `<p>Verifica tu cuenta: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
        })
      } catch (error) {
        options.logger.warn({ error, to }, 'verification email failed to send')
      }
    },
  }
}
