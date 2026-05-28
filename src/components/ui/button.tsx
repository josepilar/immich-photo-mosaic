import type * as React from 'react'
import { cn } from '~/utils/cn'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
}

export function Button({ className, variant = 'default', size = 'md', ...props }: ButtonProps) {
  const variants = {
    default: 'bg-stone-100 text-zinc-900 hover:bg-white',
    secondary: 'bg-zinc-700 text-stone-100 hover:bg-zinc-600',
    destructive: 'bg-red-700 text-white hover:bg-red-600',
    outline: 'border border-white/15 bg-transparent text-stone-100 hover:border-white/30 hover:bg-white/[0.04]',
    ghost: 'bg-transparent text-zinc-300 hover:bg-white/[0.06] hover:text-stone-100',
  }
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm' }
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
