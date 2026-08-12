import { EmailButton, EmailFooter, EmailLayout } from './layout.js'

export function PasswordResetEmail({ resetUrl }: { resetUrl: string }) {
  return (
    <EmailLayout>
      <p>Restablece la contraseña de tu cuenta de X.</p>
      <EmailButton href={resetUrl}>Restablecer contraseña</EmailButton>
      <p style={{ fontSize: '13px', color: '#64748b', marginTop: '20px', wordBreak: 'break-all' }}>
        O copia y pega este enlace: {resetUrl}
      </p>
      <EmailFooter>Si no lo pediste tú, ignora este email — tu contraseña no cambiará.</EmailFooter>
    </EmailLayout>
  )
}
