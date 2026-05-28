import type * as React from 'react'
import { cn } from '~/utils/cn'

export function Label({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('text-xs font-medium uppercase tracking-[0.16em] text-slate-400', className)} {...props} />
}
