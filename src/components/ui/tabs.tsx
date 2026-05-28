import type * as React from 'react'
import { cn } from '~/utils/cn'

export function Tabs({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-4', className)} {...props} />
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('inline-flex rounded-full border border-white/10 bg-zinc-900 p-1', className)} {...props} />
}

export function TabsTrigger({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        'rounded-full px-3 py-1.5 text-sm font-medium transition disabled:opacity-50',
        active
          ? 'bg-stone-100 text-zinc-900'
          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-stone-100',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-4', className)} {...props} />
}
