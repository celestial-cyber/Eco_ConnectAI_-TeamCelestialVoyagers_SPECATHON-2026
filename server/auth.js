import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { db, publicUser } from './db.js'

/* A secret that survives restarts, so a dev reload does not sign everyone out.
   In production set JWT_SECRET and this file is never touched. */
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  const path = resolve('data/.jwt-secret')
  mkdirSync(resolve('data'), { recursive: true })
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  const s = randomBytes(48).toString('hex')
  writeFileSync(path, s, { mode: 0o600 })
  console.warn('[auth] generated a dev JWT secret in data/.jwt-secret — set JWT_SECRET in production')
  return s
}

const SECRET = loadSecret()
const TTL = '7d'

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: TTL })

export const hash = (pw) => bcrypt.hashSync(pw, 10)
export const check = (pw, stored) => bcrypt.compareSync(pw, stored)

/** Populates req.user when a valid bearer token is present. Never throws. */
export function attachUser(req, _res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (token) {
    try {
      const { sub } = jwt.verify(token, SECRET)
      const row = db.prepare('select * from profiles where id = ?').get(sub)
      if (row) req.user = publicUser(row)
    } catch {
      /* expired or tampered — treated as signed out */
    }
  }
  next()
}

export const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Sign in to continue.' })

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'That is not available to your account type.' })
    }
    next()
  }

/* --- ownership guards: the server decides, never the client --- */

export function ownsIndustry(req, res, next) {
  const row = db.prepare('select owner_id from industries where id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Organisation not found.' })
  if (row.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'That organisation is not yours.' })
  }
  next()
}

export function ownsRun(req, res, next) {
  const row = db
    .prepare(
      `select r.id from runs r join delivery_agents a on a.id = r.agent_id
        where r.id = ? and a.profile_id = ?`
    )
    .get(req.params.id, req.user.id)
  if (!row) return res.status(403).json({ error: 'That run is not assigned to you.' })
  next()
}
