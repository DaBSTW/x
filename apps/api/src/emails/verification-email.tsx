import { EmailButton, EmailLayout } from './layout.js'

export function VerificationEmail({ verifyUrl }: { verifyUrl: string }) {
  return (
    <EmailLayout>
      <p>Verifica tu cuenta para empezar a usar X.</p>
      <EmailButton href={verifyUrl}>Verificar mi cuenta</EmailButton>
      <p style={{ fontSize: '13px', color: '#64748b', marginTop: '20px', wordBreak: 'break-all' }}>
        O copia y pega este enlace: {verifyUrl}
      </p>
    </EmailLayout>
  )
}
