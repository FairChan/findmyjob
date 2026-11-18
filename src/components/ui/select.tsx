'use client'

/**
 * Drop-in replacement for a native single <select>, with the React Bits
 * GlideSelect motion: the menu grows out of the field's corner, a pill
 * glides between rows, press-drag-release picks, and the label swaps with a
 * short blur.
 *
 * The native <select> stays in the DOM as the real control. It keeps the id,
 * name, value, required and aria props, so <label htmlFor>, form submission
 * (including server GET forms), native validation, screen readers and tests
 * that call selectOption() behave as before. It sits transparent over the
 * field and takes keyboard focus; pointer input goes to the visible field.
 * The menu is drawn in the top layer (Popover API) so dialogs and scrolling
 * tables cannot clip it.
 */

import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

type OptionRow = { kind: 'option'; index: number; value: string; label: string; tag?: string; disabled: boolean }
type GroupRow = { kind: 'group'; key: string; label: string }
type Row = OptionRow | GroupRow
type Snapshot = { rows: Row[]; options: OptionRow[]; value: string; label: string | null; disabled: boolean }

export type SelectProps = React.ComponentPropsWithRef<'select'> & {
  /** Menu width in pixels; never narrower than the field. */
  menuWidth?: number
  /** Which field edge the menu shares. */
  align?: 'left' | 'right'
  /** Preferred side; flips when that side lacks room. */
  placement?: 'top' | 'bottom'
  /** Milliseconds the menu takes to grow; it leaves in two thirds of that. */
  popDuration?: number
  /** Milliseconds the pill takes between rows; 0 is a plain hover. */
  glideDuration?: number
  /** Keep the pill on the row the pointer left. */
  rememberPosition?: boolean
  /** Show `data-tag` of each <option> muted at the right. */
  showTags?: boolean
  /** Field text while no option is selected. */
  placeholder?: string
}

const MENU_GAP = 6
const VIEWPORT_MARGIN = 8
const MAX_MENU_HEIGHT = 320
const TAP_SLOP = 8

const hasPopover = () => typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'

function readSnapshot(select: HTMLSelectElement): Snapshot {
  const rows: Row[] = []
  const options: OptionRow[] = []
  const push = (option: HTMLOptionElement, groupDisabled: boolean) => {
    if (option.hidden) return
    const row: OptionRow = {
      kind: 'option',
      index: options.length,
      value: option.value,
      label: option.label || option.text,
      tag: option.dataset.tag || undefined,
      disabled: option.disabled || groupDisabled,
    }
    options.push(row)
    rows.push(row)
  }
  for (const child of Array.from(select.children)) {
    if (child instanceof HTMLOptionElement) push(child, false)
    else if (child instanceof HTMLOptGroupElement) {
      rows.push({ kind: 'group', key: `g${rows.length}`, label: child.label })
      for (const option of Array.from(child.children)) {
        if (option instanceof HTMLOptionElement) push(option, child.disabled)
      }
    }
  }
  const chosen = select.selectedIndex >= 0 ? select.options[select.selectedIndex] : undefined
  return {
    rows,
    options,
    value: select.value,
    label: chosen ? chosen.label || chosen.text : null,
    disabled: select.disabled || select.matches(':disabled'),
  }
}

const sameSnapshot = (a: Snapshot | null, b: Snapshot) => !!a && JSON.stringify(a) === JSON.stringify(b)

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children)
  return ''
}

/** Label for the first paint (server render and hydration), read from the <option> children. */
function labelFromChildren(children: React.ReactNode, value: string | undefined): string | null {
  const found: { value: string; label: string; disabled: boolean }[] = []
  const walk = (nodes: React.ReactNode) => {
    React.Children.forEach(nodes, (node) => {
      if (!React.isValidElement(node)) return
      const props = node.props as { children?: React.ReactNode; value?: unknown; label?: string; disabled?: boolean; hidden?: boolean }
      if (node.type === 'option') {
        const label = props.label ?? textOf(props.children)
        found.push({ value: props.value !== undefined ? String(props.value) : label, label, disabled: !!props.disabled })
      } else if (node.type === 'optgroup' || node.type === React.Fragment) walk(props.children)
    })
  }
  walk(children)
  if (value !== undefined) return found.find((option) => option.value === value)?.label ?? null
  return (found.find((option) => !option.disabled) ?? found[0])?.label ?? null
}

function nextEnabled(options: OptionRow[], from: number, step: 1 | -1): number {
  for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i
  return from
}

function edgeEnabled(options: OptionRow[], end: boolean): number {
  return end ? nextEnabled(options, options.length, -1) : nextEnabled(options, -1, 1)
}

function typeaheadIndex(options: OptionRow[], from: number, char: string): number {
  const c = char.toLocaleLowerCase()
  const n = options.length
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n
    if (!options[i].disabled && options[i].label.toLocaleLowerCase().startsWith(c)) return i
  }
  return from
}

export function Select(props: SelectProps) {
  if (props.multiple || (props.size !== undefined && props.size > 1)) {
    const { menuWidth, align, placement, popDuration, glideDuration, rememberPosition, showTags, placeholder, ...rest } = props
    void menuWidth; void align; void placement; void popDuration; void glideDuration; void rememberPosition; void showTags; void placeholder
    return <select {...rest} />
  }
  return <GlideField {...props} />
}

function GlideField({
  className,
  style,
  children,
  ref,
  onKeyDown,
  menuWidth = 176,
  align = 'left',
  placement = 'bottom',
  popDuration = 180,
  glideDuration = 220,
  rememberPosition = true,
  showTags = true,
  placeholder,
  ...selectProps
}: SelectProps) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const selectRef = React.useRef<HTMLSelectElement | null>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const pillRef = React.useRef<HTMLSpanElement>(null)
  const liveRef = React.useRef<HTMLSpanElement>(null)
  const instant = React.useRef(false)
  const keyNav = React.useRef(false)
  const focusOnPick = React.useRef(true)
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scrub = React.useRef<{ id: number; x: number; y: number; capture: boolean; moved: boolean } | null>(null)

  const [snap, setSnap] = React.useState<Snapshot | null>(null)
  const [phase, setPhase] = React.useState<'closed' | 'open' | 'closing'>('closed')
  const [active, setActive] = React.useState<number | null>(null)

  const setSelectRef = React.useCallback(
    (node: HTMLSelectElement | null) => {
      selectRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  const sync = React.useCallback(() => {
    const select = selectRef.current
    if (!select) return
    const next = readSnapshot(select)
    setSnap((prev) => (sameSnapshot(prev, next) ? prev : next))
  }, [])

  // Controlled values and option lists settle in the DOM on every commit.
  React.useLayoutEffect(sync)

  React.useEffect(() => {
    const select = selectRef.current
    if (!select) return undefined
    // A controlled parent may reject a pick; React restores the old value
    // right after the change event, so read it once that has happened.
    const later = () => queueMicrotask(sync)
    const observer = new MutationObserver(sync)
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true })
    select.addEventListener('change', later)
    select.addEventListener('input', later)
    const form = select.form
    const onReset = () => setTimeout(sync)
    form?.addEventListener('reset', onReset)
    return () => {
      observer.disconnect()
      select.removeEventListener('change', later)
      select.removeEventListener('input', later)
      form?.removeEventListener('reset', onReset)
    }
  }, [sync])

  const options = snap?.options ?? []
  const rows = snap?.rows ?? []
  const selected = snap ? options.findIndex((option) => option.value === snap.value) : -1
  const initialValue = selectProps.value ?? selectProps.defaultValue
  const label = snap
    ? snap.label
    : labelFromChildren(children, initialValue === undefined ? undefined : String(initialValue))
  const disabled = snap ? snap.disabled : !!selectProps.disabled
  const popOut = Math.round((popDuration * 2) / 3)

  const place = React.useCallback(() => {
    const root = rootRef.current
    const menu = menuRef.current
    const list = listRef.current
    if (!root || !menu || !list) return
    const r = root.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    // Grow to fit the longest option (offsetWidth ignores the pop transform),
    // never narrower than the field and never wider than the viewport.
    menu.style.width = 'max-content'
    const content = menu.offsetWidth + (menu.scrollHeight > menu.clientHeight ? 12 : 0)
    const width = Math.min(Math.max(menuWidth, r.width, content), vw - VIEWPORT_MARGIN * 2)
    menu.style.width = `${width}px`
    const chrome = menu.offsetHeight - menu.clientHeight + 8
    const natural = list.scrollHeight + chrome
    const below = vh - r.bottom - MENU_GAP - VIEWPORT_MARGIN
    const above = r.top - MENU_GAP - VIEWPORT_MARGIN
    let side = placement
    if (side === 'bottom' && natural > below && above > below) side = 'top'
    else if (side === 'top' && natural > above && below > above) side = 'bottom'
    const room = side === 'bottom' ? below : above
    const maxHeight = Math.max(120, Math.min(MAX_MENU_HEIGHT, room))
    menu.style.maxHeight = `${maxHeight}px`
    menu.dataset.side = side
    menu.style.transformOrigin = `${side === 'bottom' ? 'top' : 'bottom'} ${align}`
    if (natural > maxHeight) menu.dataset.scrollable = ''
    else delete menu.dataset.scrollable
    if (menu.dataset.fallback !== undefined) return
    const height = Math.min(natural, maxHeight)
    const rawLeft = align === 'left' ? r.left : r.right - width
    const left = Math.min(Math.max(rawLeft, VIEWPORT_MARGIN), vw - width - VIEWPORT_MARGIN)
    menu.style.left = `${left}px`
    menu.style.top = `${side === 'bottom' ? r.bottom + MENU_GAP : r.top - MENU_GAP - height}px`
  }, [align, menuWidth, placement])

  const rowElement = (index: number) =>
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? null

  const revealRow = (row: HTMLElement, center: boolean) => {
    const menu = menuRef.current
    const list = listRef.current
    if (!menu || !list) return
    const top = list.offsetTop + row.offsetTop
    const bottom = top + row.offsetHeight
    if (center) menu.scrollTop = top - (menu.clientHeight - row.offsetHeight) / 2
    else if (top < menu.scrollTop + 4) menu.scrollTop = top - 4
    else if (bottom > menu.scrollTop + menu.clientHeight - 4) menu.scrollTop = bottom - menu.clientHeight + 4
  }

  React.useLayoutEffect(() => {
    if (phase !== 'open') return
    const menu = menuRef.current
    if (!menu) return
    if (menu.dataset.fallback === undefined && !menu.matches(':popover-open')) menu.showPopover()
    place()
    menu.style.transitionDuration = ''
    menu.dataset.state = 'closed'
    void menu.offsetHeight
    menu.dataset.state = 'open'
    const pill = pillRef.current
    const row = rowElement(Math.max(0, selected))
    if (pill && row) {
      pill.style.transition = 'none'
      pill.style.transform = `translateY(${row.offsetTop}px)`
      pill.style.height = `${row.offsetHeight}px`
      pill.style.opacity = '0'
      void pill.offsetHeight
      pill.style.transition = ''
      if (selected >= 0) revealRow(row, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  React.useLayoutEffect(() => {
    const pill = pillRef.current
    if (!pill || phase !== 'open') return
    if (active === null) {
      pill.style.opacity = '0'
      return
    }
    const row = rowElement(active)
    if (!row) return
    const jump = instant.current || pill.style.opacity !== '1'
    pill.style.transitionDuration = jump ? '0ms, 150ms' : ''
    pill.style.transform = `translateY(${row.offsetTop}px)`
    pill.style.height = `${row.offsetHeight}px`
    pill.style.opacity = '1'
    if (keyNav.current) {
      revealRow(row, false)
      if (liveRef.current) liveRef.current.textContent = options[active]?.label ?? ''
    }
    instant.current = false
    keyNav.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, phase])

  const open = (viaKey: boolean) => {
    if (disabled) return
    clearTimeout(closeTimer.current)
    instant.current = true
    setActive(selected >= 0 ? selected : viaKey ? edgeEnabled(options, false) : null)
    setPhase('open')
  }

  const close = (mode: 'pop' | 'instant') => {
    setActive(null)
    clearTimeout(closeTimer.current)
    if (liveRef.current) liveRef.current.textContent = ''
    const menu = menuRef.current
    if (mode === 'instant' || !menu) {
      setPhase('closed')
      return
    }
    menu.style.transitionDuration = ''
    menu.dataset.state = 'closed'
    setPhase('closing')
    closeTimer.current = setTimeout(() => setPhase('closed'), popOut + 20)
  }

  const pick = (index: number, viaKey: boolean) => {
    const option = options[index]
    if (option?.disabled) return
    const select = selectRef.current
    if (option && select && option.value !== select.value) {
      select.value = option.value
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      if (!viaKey && rootRef.current) rootRef.current.dataset.swap = ''
    }
    close('instant')
    if (focusOnPick.current) select?.focus({ preventScroll: true })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSelectElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || disabled || options.length === 0) return
    const k = event.key
    const printable = k.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
    const cur = active ?? Math.max(0, selected)
    if (phase !== 'open') {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp' || k === 'F4') {
        event.preventDefault()
        focusOnPick.current = true
        open(true)
      } else if (k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown') {
        event.preventDefault()
      } else if (printable) {
        event.preventDefault()
        focusOnPick.current = true
        open(true)
        keyNav.current = true
        setActive(typeaheadIndex(options, selected, k))
      }
      return
    }
    const go = (index: number) => {
      event.preventDefault()
      instant.current = true
      keyNav.current = true
      setActive(index)
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (event.altKey) {
        event.preventDefault()
        close('instant')
      } else go(active === null ? cur : nextEnabled(options, cur, k === 'ArrowDown' ? 1 : -1))
    } else if (k === 'Home' || k === 'End') go(edgeEnabled(options, k === 'End'))
    else if (k === 'PageDown' || k === 'PageUp') {
      let index = cur
      for (let i = 0; i < 8; i++) index = nextEnabled(options, index, k === 'PageDown' ? 1 : -1)
      go(index)
    } else if (k === 'Enter' || k === ' ') {
      event.preventDefault()
      if (active !== null) pick(active, true)
      else close('instant')
    } else if (k === 'Escape') {
      event.preventDefault()
      close('instant')
    } else if (k === 'Tab') close('instant')
    else if (printable) go(typeaheadIndex(options, cur, k))
  }

  React.useEffect(() => {
    if (phase === 'closed') return undefined
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close('pop')
    }
    document.addEventListener('pointerdown', onDown, true)
    // Escape closes only the menu: claim it at window capture, before a
    // surrounding dialog's document-level listener would close the dialog too.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || phase !== 'open') return
      event.preventDefault()
      event.stopPropagation()
      close('instant')
    }
    window.addEventListener('keydown', onEscape, true)
    let frame = 0
    const onMove = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onEscape, true)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // A field that becomes disabled while open closes at once (adjusting state during render).
  if (disabled && phase !== 'closed') {
    setPhase('closed')
    setActive(null)
  }

  React.useEffect(() => () => clearTimeout(closeTimer.current), [])

  const rowAt = (x: number, y: number): number | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-index]')
    if (!hit || !listRef.current?.contains(hit)) return null
    const index = Number(hit.dataset.index)
    return options[index] && !options[index].disabled ? index : null
  }

  const onListDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (scrub.current) return
    const menu = menuRef.current
    const touchScroll = event.pointerType === 'touch' && menu?.dataset.scrollable !== undefined
    if (!touchScroll) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {}
    }
    scrub.current = { id: event.pointerId, x: event.clientX, y: event.clientY, capture: !touchScroll, moved: false }
    instant.current = true
    setActive(rowAt(event.clientX, event.clientY))
  }

  const onListMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = scrub.current
    if (!s || s.id !== event.pointerId) return
    if (!s.capture) {
      if (Math.hypot(event.clientX - s.x, event.clientY - s.y) > TAP_SLOP) {
        s.moved = true
        if (active !== null) setActive(null)
      }
      return
    }
    const index = rowAt(event.clientX, event.clientY)
    if (index !== active) setActive(index)
  }

  const onListUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = scrub.current
    if (!s || s.id !== event.pointerId) return
    scrub.current = null
    const index = event.type === 'pointerup' && !s.moved ? rowAt(event.clientX, event.clientY) : null
    if (index !== null) {
      focusOnPick.current = event.pointerType !== 'touch'
      pick(index, false)
    } else if (!rememberPosition) setActive(null)
  }

  const onListOver = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || scrub.current) return
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')
    if (!row) return
    const index = Number(row.dataset.index)
    if (options[index]?.disabled) return
    if (index !== active) setActive(index)
  }

  const onTriggerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || disabled) return
    const root = rootRef.current
    if (root) {
      root.dataset.pressed = ''
      const release = () => {
        delete root.dataset.pressed
        window.removeEventListener('pointerup', release)
        window.removeEventListener('pointercancel', release)
      }
      window.addEventListener('pointerup', release)
      window.addEventListener('pointercancel', release)
    }
    // Touch must not focus the native control: mobile browsers would open their own picker.
    focusOnPick.current = event.pointerType !== 'touch'
    if (focusOnPick.current) selectRef.current?.focus({ preventScroll: true })
    if (phase === 'open') close('pop')
    else open(false)
  }

  const fallback = phase !== 'closed' && !hasPopover()

  return (
    <div
      ref={rootRef}
      className={cn('glide-select', className)}
      style={
        {
          '--gs-pop': `${popDuration}ms`,
          '--gs-pop-out': `${popOut}ms`,
          '--gs-glide': `${glideDuration}ms`,
          ...style,
        } as React.CSSProperties
      }
      data-open={phase === 'open' ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === 'gs-swap' && rootRef.current) delete rootRef.current.dataset.swap
      }}
    >
      <select
        {...selectProps}
        ref={setSelectRef}
        className="glide-select__native"
        aria-expanded={phase === 'open'}
        onKeyDown={handleKeyDown}
      >
        {children}
      </select>
      <div
        className="glide-select__trigger"
        aria-hidden="true"
        onPointerDown={onTriggerDown}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span className="glide-select__label" key={snap?.value ?? 'initial'} data-empty={label === null ? '' : undefined}>
          {label ?? placeholder ?? ' '}
        </span>
        <span className="glide-select__chevron">
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        </span>
      </div>
      {phase !== 'closed' ? (
        <div
          ref={menuRef}
          popover={fallback ? undefined : 'manual'}
          className="glide-select__menu"
          data-state="open"
          data-align={align}
          data-fallback={fallback ? '' : undefined}
          aria-hidden="true"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div
            ref={listRef}
            className="glide-select__list"
            data-live={active !== null ? '' : undefined}
            onPointerOver={onListOver}
            onPointerLeave={() => {
              if (!scrub.current && !rememberPosition) setActive(null)
            }}
            onPointerDown={onListDown}
            onPointerMove={onListMove}
            onPointerUp={onListUp}
            onPointerCancel={onListUp}
            onLostPointerCapture={onListUp}
          >
            <span ref={pillRef} className="glide-select__pill" />
            {rows.map((row) =>
              row.kind === 'group' ? (
                <div key={row.key} className="glide-select__group">
                  {row.label}
                </div>
              ) : (
                <div
                  key={`o${row.index}`}
                  data-index={row.index}
                  data-selected={row.index === selected ? '' : undefined}
                  data-disabled={row.disabled ? '' : undefined}
                  className="glide-select__option"
                  title={row.label}
                >
                  <span className="glide-select__name">{row.label}</span>
                  {showTags && row.tag ? <span className="glide-select__tag">{row.tag}</span> : null}
                  <span className="glide-select__check" data-on={row.index === selected ? '' : undefined}>
                    <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      ) : null}
      <span ref={liveRef} className="sr-only" aria-live="polite" />
    </div>
  )
}
