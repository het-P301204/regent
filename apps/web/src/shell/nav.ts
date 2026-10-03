import { Activity, BookOpen, FileText, FlaskConical, GitCompare, Hammer, History, Import, Landmark, Library, Scale, Search, Settings, ShieldAlert, Timer } from 'lucide-react'
import type { ComponentType } from 'react'
import { IconAuthority, IconChain, IconCredential, IconDelegation, IconHuman, IconPolicy } from '../brand/icons'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number }>
  /** Second key after G, e.g. G then D. */
  chord?: string
  keywords?: string
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Verify',
    items: [
      { to: '/app', label: 'Command Center', icon: IconAuthority, chord: 'd', keywords: 'dashboard overview' },
      { to: '/app/chains', label: 'Chains', icon: IconChain, chord: 'c', keywords: 'delegation graph actions' },
      { to: '/app/findings', label: 'Findings', icon: ShieldAlert, chord: 'f', keywords: 'violations issues' },
      { to: '/app/investigate', label: 'Investigate', icon: Search, chord: 'v', keywords: 'incident response event' },
    ],
  },
  {
    group: 'Registry',
    items: [
      { to: '/app/identities', label: 'Identities', icon: IconHuman, chord: 'i', keywords: 'principals agents users' },
      { to: '/app/delegations', label: 'Delegations', icon: IconDelegation, chord: 'l', keywords: 'contracts grants' },
      { to: '/app/credentials', label: 'Credential lineage', icon: IconCredential, chord: 'k', keywords: 'workload svid token' },
      { to: '/app/policy', label: 'Policy engine', icon: IconPolicy, chord: 'p', keywords: 'rules auth-001' },
    ],
  },
  {
    group: 'Analyze',
    items: [
      { to: '/app/action-time', label: 'Action-time auth', icon: Timer, keywords: 'provision revocation' },
      { to: '/app/time-travel', label: 'Time travel', icon: History, chord: 't', keywords: 'authority at time' },
      { to: '/app/diff', label: 'Chain diff', icon: GitCompare, keywords: 'compare' },
      { to: '/app/grc', label: 'GRC controls', icon: Landmark, chord: 'g', keywords: 'audit compliance evidence package' },
      { to: '/app/reports', label: 'Reports & exports', icon: FileText, chord: 'r', keywords: 'pdf csv json' },
    ],
  },
  {
    group: 'Build',
    items: [
      { to: '/app/scenarios', label: 'Scenario lab', icon: FlaskConical, chord: 's', keywords: 'simulation' },
      { to: '/app/builder', label: 'Chain builder', icon: Hammer, chord: 'b', keywords: 'create custom' },
      { to: '/app/import', label: 'Import events', icon: Import, chord: 'm', keywords: 'upload json jsonl' },
    ],
  },
  {
    group: 'Learn',
    items: [
      { to: '/app/learn', label: 'Concepts', icon: BookOpen, keywords: 'learning confused deputy' },
      { to: '/app/standards', label: 'Standards mapping', icon: Scale, keywords: 'oauth oidc spiffe scim ngac mcp' },
      { to: '/docs', label: 'Documentation', icon: Library, keywords: 'docs api cli' },
    ],
  },
  {
    group: 'Workspace',
    items: [
      { to: '/app/settings', label: 'Settings', icon: Settings, keywords: 'datasets tokens audit log theme' },
      { to: '/app/activity', label: 'Run history', icon: Activity, keywords: 'verification runs' },
    ],
  },
]

export const ALL_NAV = NAV.flatMap((g) => g.items)
