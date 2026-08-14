import { EmailButton, EmailFooter, EmailLayout } from './layout.js'

type ModerationActionEmailProps = {
  heading: string
  reason: string
  /** The post's own text — SPECS.md §12.2's "el fragmento infractor". `null` for a user-level action (suspend/read_only/ban), where there's no single post to quote. */
  fragment: string | null
  appealUrl: string
}

/** Body only — moderation.service.ts's notifyTarget owns which heading goes with which action, same split as mailer.ts's own SECURITY_ALERT_COPY does for SecurityAlertEmail. */
export function ModerationActionEmail({
  heading,
  reason,
  fragment,
  appealUrl,
}: ModerationActionEmailProps) {
  return (
    <EmailLayout>
      <p style={{ fontSize: '17px', fontWeight: 600 }}>{heading}</p>
      <p>Motivo: {reason}</p>
      {fragment && (
        <p
          style={{
            borderLeft: '3px solid #e2e8f0',
            paddingLeft: '12px',
            color: '#475569',
            fontStyle: 'italic',
          }}
        >
          {fragment}
        </p>
      )}
      <EmailButton href={appealUrl}>Apelar esta decisión</EmailButton>
      <EmailFooter>
        Si crees que esto es un error, puedes apelar desde el enlace de arriba.
      </EmailFooter>
    </EmailLayout>
  )
}
