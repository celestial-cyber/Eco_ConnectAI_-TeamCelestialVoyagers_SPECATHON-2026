import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/* ---------- primitives ---------- */

export function Chip({ tone = 'mute', children, dot = true }) {
  return (
    <span className={`chip ${tone}`}>
      {dot && <i />}
      {children}
    </span>
  )
}

export function Stat({ value, label, tone }) {
  return (
    <div className="stat">
      <u className={tone}>{value}</u>
      <span>{label}</span>
    </div>
  )
}

export function Card({ title, hint, right, children, ...rest }) {
  return (
    <div className="card" {...rest}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: hint ? 0 : 14 }}>
          <div style={{ minWidth: 0 }}>
            {title && <h3>{title}</h3>}
            {hint && <div className="hint">{hint}</div>}
          </div>
          {right && <div style={{ marginLeft: 'auto', flex: 'none' }}>{right}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  )
}

export function Banner({ tone = '', label, children }) {
  return (
    <div className={`banner ${tone}`}>
      {label && <b>{label}</b>}
      <div>{children}</div>
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && (
        <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 6, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

export function Toggle({ on, onChange, children }) {
  return (
    <label className={`check ${on ? 'on' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

export function KV({ k, children }) {
  return (
    <div className="kv">
      <span>{k}</span>
      <b>{children}</b>
    </div>
  )
}

export function Steps({ steps, current }) {
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <div key={s} className={i === current ? 'on' : i < current ? 'done' : ''}>
          {String(i + 1).padStart(2, '0')} {s}
        </div>
      ))}
    </div>
  )
}

/* ---------- toasts ---------- */

const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }) {
  const [items, setItems] = useState([])

  const push = useCallback((title, body, tone = '') => {
    const id = Math.random().toString(36).slice(2)
    setItems((v) => [...v, { id, title, body, tone }])
    setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), 6000)
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <b>{t.title}</b>
            {t.body}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- formatting ---------- */

export const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export const kg = (n) => `${Number(n ?? 0).toFixed(1)} kg`
export const km = (n) => `${Number(n ?? 0).toFixed(1)} km`
