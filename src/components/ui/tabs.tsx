import * as React from 'react'
import { cn } from '~/utils/cn'

export function Tabs({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-4', className)} {...props} />
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('inline-flex rounded-lg border border-slate-800 bg-slate-950 p-1', className)} {...props} />
}

export function TabsTrigger({ active, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50',
        active ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-4', className)} {...props} />
}
