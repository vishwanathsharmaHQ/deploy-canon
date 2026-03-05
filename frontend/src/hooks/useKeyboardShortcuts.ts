import { useEffect, useRef } from 'react'

export type ShortcutMap = Record<string, { action: () => void; description: string }>

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)

function parseCombo(combo: string): { key: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean } {
  const parts = combo.toLowerCase().split('+')
  let ctrl = false
  let meta = false
  let shift = false
  let alt = false
  let key = ''

  for (const part of parts) {
    switch (part) {
      case 'mod':
        if (isMac) meta = true
        else ctrl = true
        break
      case 'ctrl':
        ctrl = true
        break
      case 'meta':
        meta = true
        break
      case 'shift':
        shift = true
        break
      case 'alt':
        alt = true
        break
      default:
        key = part
    }
  }

  return { key, ctrl, meta, shift, alt }
}

function matchesCombo(
  e: KeyboardEvent,
  combo: { key: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }
): boolean {
  const eventKey = e.key.toLowerCase()
  return (
    eventKey === combo.key &&
    e.ctrlKey === combo.ctrl &&
    e.metaKey === combo.meta &&
    e.shiftKey === combo.shift &&
    e.altKey === combo.alt
  )
}

function isEditableTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement
  if (!target) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (target.isContentEditable) return true
  return false
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap): ShortcutMap {
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const current = shortcutsRef.current
      for (const combo of Object.keys(current)) {
        const parsed = parseCombo(combo)

        // For simple single-key shortcuts (no modifier), skip when in editable fields
        const hasModifier = parsed.ctrl || parsed.meta || parsed.alt
        if (!hasModifier && isEditableTarget(e)) continue

        if (matchesCombo(e, parsed)) {
          e.preventDefault()
          e.stopPropagation()
          current[combo].action()
          return
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return shortcuts
}

/** Format a combo string for display, e.g. "Mod+k" → "⌘K" or "Ctrl+K" */
export function formatShortcut(combo: string): string {
  const parts = combo.split('+')
  return parts
    .map(p => {
      switch (p.toLowerCase()) {
        case 'mod': return isMac ? '\u2318' : 'Ctrl'
        case 'ctrl': return isMac ? '\u2303' : 'Ctrl'
        case 'meta': return isMac ? '\u2318' : 'Win'
        case 'shift': return '\u21E7'
        case 'alt': return isMac ? '\u2325' : 'Alt'
        case 'escape': return 'Esc'
        default: return p.toUpperCase()
      }
    })
    .join(isMac ? '' : '+')
}
