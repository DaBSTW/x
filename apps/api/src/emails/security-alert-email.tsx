import { EmailFooter, EmailLayout } from './layout.js'

type SecurityAlertEmailProps = {
  heading: string
  ipAddress: string | null
  userAgent: string | null
}

/** Body only — mailer.ts still owns which heading/subject goes with which SecurityAlertKind, the same separation register/verify-email already had between "what to send" and "how it looks". */
export function SecurityAlertEmail({ heading, ipAddress, userAgent }: SecurityAlertEmailProps) {
  return (
    <EmailLayout>
      <p style={{ fontSize: '17px', fontWeight: 600 }}>{heading}</p>
      <p>
        IP: {ipAddress ?? 'desconocida'} · Dispositivo: {userAgent ?? 'desconocido'}
      </p>
      <EmailFooter>Si no fuiste tú, cambia tu contraseña de inmediato.</EmailFooter>
    </EmailLayout>
  )
}
