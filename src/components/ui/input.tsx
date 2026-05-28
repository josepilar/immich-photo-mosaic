import type * as React from 'react'
import { cn } from '~/utils/cn'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-xl border border-white/10 bg-zinc-800 px-3.5 text-sm text-stone-100 outline-none transition placeholder:text-zinc-500 focus:border-stone-300',
        className,
      )}
      {...props}
    />
  )
}
