import { ResetPasswordForm } from '@/components/reset-password-form'
import { Suspense } from 'react'

export default function ResetPasswordPage() {
  // useSearchParams() (reading ?token=) requires a Suspense boundary so the
  // rest of the route can still prerender.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
