import { createContext, useContext, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, setCsrf } from './api'
import type { Role, SessionInfo } from './types'
import { ROLE_RANK } from './format'

interface SessionCtx {
  session: SessionInfo | undefined
  loading: boolean
  refresh: () => Promise<void>
  can: (min: Role) => boolean
}

const Ctx = createContext<SessionCtx>({ session: undefined, loading: true, refresh: async () => {}, can: () => false })

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['session'], queryFn: () => api.get<SessionInfo>('/api/auth/session'), staleTime: 60_000, retry: 1 })
  useEffect(() => {
    setCsrf(q.data?.csrf_token ?? null)
  }, [q.data?.csrf_token])
  const value: SessionCtx = {
    session: q.data,
    loading: q.isLoading,
    refresh: async () => {
      await qc.invalidateQueries()
    },
    can: (min) => !!q.data?.user && ROLE_RANK[q.data.user.role] >= ROLE_RANK[min],
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useSession = () => useContext(Ctx)
