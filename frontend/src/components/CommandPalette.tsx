import { useState, useEffect, useRef, useCallback } from 'react'
import { formatShortcut } from '../hooks/useKeyboardShortcuts'

export interface Command {
  id: string
  name: string
  description: string
  shortcut?: string
  action: () => void
}

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

export default function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = query
    ? commands.filter(
        c =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.description.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const execute = useCallback(
    (cmd: Command) => {
      onClose()
      // Run action after close to avoid state conflicts
      requestAnimationFrame(() => cmd.action())
    },
    [onClose]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => (i + 1) % filtered.length || 0)
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length || 0)
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[selectedIndex]) execute(filtered[selectedIndex])
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  return (
    <div
      style={styles.overlay}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div style={styles.palette} onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={styles.input}
        />
        <div ref={listRef} style={styles.list}>
          {filtered.length === 0 ? (
            <div style={styles.empty}>No matching commands</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                style={{
                  ...styles.item,
                  ...(i === selectedIndex ? styles.itemSelected : {}),
                }}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div style={styles.itemLeft}>
                  <div style={styles.itemName}>{cmd.name}</div>
                  <div style={styles.itemDesc}>{cmd.description}</div>
                </div>
                {cmd.shortcut && (
                  <div style={styles.shortcutBadge}>
                    {formatShortcut(cmd.shortcut)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '20vh',
    zIndex: 9999,
  },
  palette: {
    width: '100%',
    maxWidth: 520,
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  input: {
    width: '100%',
    padding: '14px 18px',
    fontSize: 15,
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #333',
    color: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  list: {
    maxHeight: 340,
    overflowY: 'auto',
    padding: '6px 0',
  },
  empty: {
    padding: '20px 18px',
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 18px',
    cursor: 'pointer',
    borderRadius: 6,
    margin: '2px 6px',
  },
  itemSelected: {
    background: '#2a2a2a',
  },
  itemLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  itemName: {
    color: '#e0e0e0',
    fontSize: 14,
    fontWeight: 500,
  },
  itemDesc: {
    color: '#777',
    fontSize: 12,
  },
  shortcutBadge: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 5,
    padding: '2px 8px',
    fontSize: 12,
    color: '#00ff9d',
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    marginLeft: 12,
  },
}
