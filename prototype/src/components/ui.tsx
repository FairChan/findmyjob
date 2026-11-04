import { useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import type { Company } from '../data/mock'
import { cn, colorFor } from '../lib/utils'

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'success' | 'white' | 'soft'
type Size = 'xs' | 'sm' | 'md' | 'lg'
export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra?: string) =>
  cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
    {
      primary: 'bg-brand-500 text-white hover:bg-brand-600',
      outline: 'border border-brand-500 bg-white text-brand-500 hover:bg-brand-50',
      ghost: 'text-gray-600 hover:bg-gray-100',
      danger: 'bg-red-500 text-white hover:bg-red-600',
      success: 'bg-emerald-500 text-white hover:bg-emerald-600',
      white: 'border border-gray-200 bg-white text-gray-700 hover:border-brand-400 hover:text-brand-500',
      soft: 'bg-brand-50 text-brand-600 hover:bg-brand-100',
    }[variant],
    { xs: 'h-7 px-2.5 text-xs', sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' }[size],
    extra,
  )

export function Button({ variant, size, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...p} />
}

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-gray-100 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]', className)} {...p}>{children}</div>
}

type Tone = 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'amber'
const TONES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-600',
  blue: 'bg-brand-50 text-brand-600',
  green: 'bg-emerald-50 text-emerald-700',
  orange: 'bg-orange-50 text-orange-600',
  red: 'bg-red-50 text-red-600',
  purple: 'bg-violet-50 text-violet-700',
  amber: 'bg-amber-50 text-amber-700',
}
export function Tag({ tone = 'gray', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs leading-5', TONES[tone], className)}>{children}</span>
}

export function Avatar({ name, size = 40, masked, className }: { name: string; size?: number; masked?: boolean; className?: string }) {
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.4, background: masked ? '#9aa3b2' : colorFor(name) }}
    >
      {name.trim()[0]?.toUpperCase()}
    </span>
  )
}

export function CompanyLogo({ company, size = 40, className }: { company: Pick<Company, 'short' | 'color'>; size?: number; className?: string }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-lg font-bold text-white', className)} style={{ width: size, height: size, fontSize: size * 0.36, background: company.color }}>
      {company.short.slice(0, 2)}
    </span>
  )
}

export function LogoMark({ size = 28, invert }: { size?: number; invert?: boolean }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-lg font-bold', invert ? 'bg-white text-brand-500' : 'bg-brand-500 text-white')} style={{ width: size, height: size, fontSize: size * 0.5 }}>
      F
    </span>
  )
}

export function Modal({ open, onClose, title, children, footer, width = 480, side }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; side?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className={cn('fixed inset-0 z-[90] flex bg-black/40', side ? 'justify-end' : 'items-center justify-center p-4')} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cn('flex max-h-full w-full flex-col bg-white shadow-2xl', side ? 'h-full animate-[slidein_.2s_ease-out]' : 'max-h-[90vh] rounded-2xl animate-[fadein_.15s_ease-out]')}
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={onClose} aria-label="关闭"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors', checked ? 'bg-brand-500' : 'bg-gray-300')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100'
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, 'h-10', className)} {...p} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, 'py-2', className)} rows={4} {...p} />
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, 'h-10 cursor-pointer', className)} {...p} />

export function Field({ label, hint, required, children, className }: { label: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}{required && <span className="ml-0.5 text-red-500">*</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  )
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-full border px-3 py-1 text-sm transition-colors cursor-pointer', active ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-300')}
    >
      {children}
    </button>
  )
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-gray-100', className)}>
      <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  )
}

export function Empty({ icon, title, desc, action }: { icon?: ReactNode; title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-gray-300">{icon}</div>}
      <p className="font-medium text-gray-700">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-sm text-gray-400">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        {sub && <p className="mt-1 text-sm text-gray-500">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-sm text-gray-500">{label}{icon && <span className="text-gray-300">{icon}</span>}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
    </Card>
  )
}

export function TagInput({ value, onChange, placeholder, max = 30 }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number }) {
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`删除 ${t}`}><X className="size-3" /></button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none"
        placeholder={value.length ? '' : placeholder}
        onKeyDown={(e) => {
          // 中文输入法选词时按回车是在确认候选词，不能当成"添加标签"（keyCode 229 是部分浏览器的组合输入标记）
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          const v = e.currentTarget.value.trim()
          if ((e.key === 'Enter' || e.key === ',' || e.key === '，') && v) {
            e.preventDefault()
            if (!value.includes(v) && value.length < max) onChange([...value, v])
            e.currentTarget.value = ''
          }
        }}
      />
    </div>
  )
}
