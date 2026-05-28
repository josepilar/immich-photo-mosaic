import type * as React from 'react'
import { cn } from '~/utils/cn'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
}

export function Button({ className, variant = 'default', size = 'md', ...props }: ButtonProps) {
  const variants = {
    default: 'bg-cyan-500 text-slate-950 hover:bg-cyan-400',
    secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700',
    destructive: 'bg-red-500 text-white hover:bg-red-400',
    outline: 'border border-slate-700 bg-transparent text-slate-100 hover:bg-slate-800',
    ghost: 'bg-transparent text-slate-300 hover:bg-slate-800',
  }
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm' }
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
