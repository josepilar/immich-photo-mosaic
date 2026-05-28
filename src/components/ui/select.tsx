import type * as React from 'react'
import { cn } from '~/utils/cn'

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-xl border border-white/10 bg-zinc-800 px-3.5 text-sm text-stone-100 outline-none transition focus:border-stone-300',
        className,
      )}
      {...props}
    />
  )
}
