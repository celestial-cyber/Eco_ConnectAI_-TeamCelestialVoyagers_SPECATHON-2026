import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { db } from '../lib/db.js'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    db.getSession()
      .then((s) => alive && setUser(s?.user ?? null))
      .catch(() => {})
      .finally(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [])

  const signIn = useCallback(async (creds) => {
    const { user } = await db.signIn(creds)
    setUser(user)
    return user
  }, [])

  const signUp = useCallback(async (data) => {
    const { user } = await db.signUp(data)
    setUser(user)
    return user
  }, [])

  const signOut = useCallback(async () => {
    await db.signOut()
    setUser(null)
  }, [])

  const refresh = useCallback(async () => {
    const s = await db.getSession()
    setUser(s?.user ?? null)
  }, [])

  return (
    <Ctx.Provider value={{ user, ready, signIn, signUp, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  )
}
