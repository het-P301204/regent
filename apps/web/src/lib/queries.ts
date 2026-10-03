import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { DatasetRow } from './types'

/** Every query key that depends on the active dataset starts with 'ws'. */
export const wsKey = (...parts: unknown[]) => ['ws', ...parts]

export function useDatasets() {
  return useQuery({ queryKey: ['datasets'], queryFn: () => api.get<{ active_dataset_id: string | null; datasets: DatasetRow[] }>('/api/datasets') })
}

export function useActiveDataset() {
  const q = useDatasets()
  const active = q.data?.datasets.find((d) => d.id === q.data?.active_dataset_id) ?? null
  return { ...q, active }
}

/** Switching dataset invalidates every dataset-scoped view at once. */
export function useActivateDataset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/api/datasets/${encodeURIComponent(id)}/activate`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['datasets'] })
      await qc.invalidateQueries({ queryKey: ['ws'] })
    },
  })
}

export function useResetDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/api/datasets/reset-demo'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['datasets'] })
      await qc.invalidateQueries({ queryKey: ['ws'] })
    },
  })
}

export interface AnalyzeResult {
  run_id: string
  dataset_id: string
  input_digest: string
  ruleset_version: string
  summary: { total_actions: number; authority_violations: number; unattributable_actions: number }
}

export function useRunVerification() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<AnalyzeResult>('/api/analyze'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['ws'] })
      await qc.invalidateQueries({ queryKey: ['datasets'] })
    },
  })
}

/** After any call that creates and activates a dataset. */
export async function afterDatasetChange(qc: ReturnType<typeof useQueryClient>) {
  await qc.invalidateQueries({ queryKey: ['datasets'] })
  await qc.invalidateQueries({ queryKey: ['ws'] })
}
