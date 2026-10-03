import { normalizeRecords, normalizeText } from './normalize.ts'
import type { NormalizeResult } from './normalize.ts'
import { verify } from './verify.ts'
import type { VerifyOptions } from './verify.ts'
import type { VerificationRun } from './types.ts'

export interface AnalysisResult {
  normalized: NormalizeResult
  run: VerificationRun
}

/** Ingestion -> normalization -> verification, in one call. Input is untrusted. */
export function analyze(input: string | unknown[], options: VerifyOptions = {}): AnalysisResult {
  const normalized = typeof input === 'string' ? normalizeText(input) : normalizeRecords(input)
  return { normalized, run: verify(normalized.bundle, options) }
}
