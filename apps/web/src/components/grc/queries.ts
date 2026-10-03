import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { wsKey } from '../../lib/queries'
import type { ControlEvaluation, FindingStatus, RuleSet } from '../../lib/types'

export type ControlRow = ControlEvaluation & { finding_statuses: Record<string, FindingStatus> }
export type ControlResult = ControlEvaluation['result']

export interface GrcResponse {
  controls: ControlRow[]
  definitions: unknown[]
  run: { id: string; input_digest: string; ruleset_version: string }
}

/** Control evaluation for the active dataset. Shared by the GRC and Reports pages so both read one cache entry. */
export function useGrcControls() {
  return useQuery({ queryKey: wsKey('grc', 'controls'), queryFn: () => api.get<GrcResponse>('/api/grc/controls') })
}

/** The organization's rule set (not dataset-scoped). */
export function useRuleSet() {
  return useQuery({ queryKey: ['rules'], queryFn: () => api.get<RuleSet>('/api/rules'), staleTime: 60_000 })
}
