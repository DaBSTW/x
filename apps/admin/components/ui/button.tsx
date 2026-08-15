import { cn } from '@/lib/cn'
import type { ButtonHTMLAttributes } from 'react'

// No class-variance-authority/@radix-ui/react-slot here (unlike apps/web's
// own components/ui/button.tsx) — this app never needs to render a Button
// "as" a Link (every link here is a plain <Link className="…">), so the
// polymorphic asChild trick has nothing to earn its dependency weight.
const VARIANT_CLASSES = {
  default: 'bg-primary text-primary-foreground hover:opacity-90',
  outline: 'border border-border bg-transparent hover:bg-muted',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
  ghost: 'hover:bg-muted',
} as const

const SIZE_CLASSES = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 px-3',
} as const

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANT_CLASSES
  size?: keyof typeof SIZE_CLASSES
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  )
}
