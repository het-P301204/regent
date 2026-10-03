import { EvidenceBuilder } from './builder.ts'
import type { RawRecord } from './builder.ts'

/**
 * "Acme AI Operations": a fictional organisation's agent activity on one day,
 * 03 Oct 2026. Every name, id and credential is invented. Most chains are
 * healthy; a handful are not, so the first screen shows both.
 *
 * Deterministic: no clock, no randomness. Re-running produces identical records.
 */

const D = '2026-10-03'
const t = (hhmm: string, ss = '00') => `${D}T${hhmm}:${ss}Z`

export const DEMO_ORGANIZATION = { name: 'Acme AI Operations', slug: 'acme-ai-ops' }

export function demoRecords(): RawRecord[] {
  const b = new EvidenceBuilder()

  // ---- humans (root principals)
  b.human('human-maya', 'Maya Chen', ['invoice.read', 'invoice.write', 'invoice.approve', 'ledger.read', 'ledger.write', 'report.export'])
  b.human('human-daniel', 'Daniel Okafor', ['customer.read', 'customer.write', 'ticket.read', 'ticket.write', 'email.draft'])
  b.human('human-priya', 'Priya Nair', ['incident.read', 'incident.write', 'log.read', 'ticket.read'])
  b.human('human-tom', 'Tom Becker', ['crm.read', 'crm.write', 'report.export'], { revoked: t('13:00') })

  // ---- agents
  b.agent('agent-ops', 'OperationsAgent')
  b.agent('agent-invoice', 'InvoiceAgent', 'sub_agent')
  b.agent('agent-recon', 'ReconciliationAgent', 'sub_agent')
  b.agent('agent-report', 'ReportingAgent', 'sub_agent')
  b.agent('agent-support', 'SupportAgent')
  b.agent('agent-lookup', 'CustomerLookupAgent', 'sub_agent')
  b.agent('agent-reply', 'ReplyDraftAgent', 'sub_agent')
  b.agent('agent-triage', 'TriageAgent')
  b.agent('agent-forecast', 'ForecastAgent')
  b.agent('agent-sync', 'NightlySyncAgent')

  // ---- execution identities (workloads) and credentials
  b.workload('wl-ops-01', 'agent-ops', { provisioned: ['invoice.read', 'ledger.read'] })
  b.workload('wl-invoice-07', 'agent-invoice', { provisioned: ['invoice.read', 'invoice.write', 'invoice.approve'] })
  b.workload('wl-recon-04', 'agent-recon', { provisioned: ['ledger.read', 'ledger.write'] })
  b.workload('wl-report-02', 'agent-report', { provisioned: ['invoice.read', 'ledger.read', 'report.export'] })
  b.workload('wl-support-01', 'agent-support', { provisioned: ['customer.read', 'ticket.read', 'ticket.write'] })
  b.workload('wl-lookup-05', 'agent-lookup', { provisioned: ['customer.read'] })
  b.workload('wl-reply-03', 'agent-reply', { provisioned: ['email.draft', 'ticket.read'] })
  b.workload('wl-triage-01', 'agent-triage', { provisioned: ['incident.read', 'log.read', 'ticket.read'] })
  b.workload('wl-forecast-01', 'agent-forecast', { provisioned: ['crm.read', 'report.export'] })
  b.workload('wl-sync-09', 'agent-sync', { provisioned: ['crm.read', 'customer.read', 'customer.write'] })
  b.workload('wl-shared-batch', 'agent-sync', { provisioned: ['ledger.read', 'ledger.write', 'invoice.read'] })

  b.credential('svid-ops-01', 'wl-ops-01')
  b.credential('svid-invoice-07', 'wl-invoice-07')
  b.credential('svid-recon-04', 'wl-recon-04')
  b.credential('svid-report-02', 'wl-report-02')
  b.credential('svid-support-01', 'wl-support-01')
  b.credential('svid-lookup-05', 'wl-lookup-05', { revoked: t('15:30') })
  b.credential('svid-reply-03', 'wl-reply-03')
  b.credential('svid-triage-01', 'wl-triage-01')
  b.credential('svid-forecast-01', 'wl-forecast-01', { type: 'oauth_access_token' })
  b.credential('svid-sync-09', 'wl-sync-09', { type: 'api_key', issued: '2026-09-01T00:00:00Z', expires: '2026-12-01T00:00:00Z' })
  b.credential('tok-batch-legacy', 'wl-shared-batch', { type: 'service_credential', issued: '2026-08-01T00:00:00Z', expires: '2027-08-01T00:00:00Z' })

  // ---- tools and resources
  b.tool('tool-invoice-lookup', 'InvoiceLookup')
  b.tool('tool-invoice-approve', 'InvoiceApprove')
  b.tool('tool-ledger-query', 'LedgerQuery', 'connector')
  b.tool('tool-ledger-post', 'LedgerPost', 'connector')
  b.tool('tool-report-export', 'ReportExport', 'api')
  b.tool('tool-customer-search', 'CustomerSearch')
  b.tool('tool-ticket-update', 'TicketUpdate', 'api')
  b.tool('tool-email-draft', 'EmailDraft', 'function')
  b.tool('tool-log-search', 'LogSearch')
  b.tool('tool-crm-query', 'CRMQuery', 'api')
  b.resource('res-invoice-db', 'InvoiceDB')
  b.resource('res-ledger-db', 'LedgerDB')
  b.resource('res-customer-db', 'CustomerDB')
  b.resource('res-ticket-system', 'TicketSystem', 'application')
  b.resource('res-report-bucket', 'ReportBucket', 'object')
  b.resource('res-log-store', 'LogStore', 'service')
  b.resource('res-crm', 'CRM', 'application')

  // ---- authorization policies recorded by Acme's agent gateway
  b.policy('pol-agent-delegation', '4', 'Agent delegation policy')
  b.policy('pol-finance-agents', '12', 'Finance agent runtime', { ceiling: ['invoice.read', 'invoice.write', 'invoice.approve', 'ledger.read', 'ledger.write', 'report.export'], approval: ['invoice.approve', 'ledger.write'] })
  b.policy('pol-support-agents', '5', 'Support agent runtime', { ceiling: ['customer.read', 'ticket.read', 'ticket.write', 'email.draft'], approval: [] })
  b.policy('pol-security-agents', '3', 'Security agent runtime', { approval: [] })
  b.policy('pol-agent-runtime', '7', 'General agent runtime', { approval: ['customer.write'] })

  // ---- delegations
  b.delegate({ id: 'del-maya-ops', from: 'human-maya', to: 'agent-ops', granted: ['invoice.read', 'invoice.write', 'invoice.approve', 'ledger.read', 'report.export'], at: t('08:00'), expires: t('20:00'), restrictions: ['business-hours'], event: 'evt-del-0001' })
  b.delegate({ id: 'del-ops-invoice', from: 'agent-ops', to: 'agent-invoice', parent: 'del-maya-ops', granted: ['invoice.read', 'invoice.approve'], at: t('08:02'), expires: t('18:00'), restrictions: ['invoice.amount<=25000'], event: 'evt-del-0002' })
  b.delegate({ id: 'del-ops-recon', from: 'agent-ops', to: 'agent-recon', parent: 'del-maya-ops', granted: ['ledger.read'], at: t('08:03'), expires: t('18:00'), event: 'evt-del-0003' })
  b.delegate({ id: 'del-ops-report', from: 'agent-ops', to: 'agent-report', parent: 'del-maya-ops', granted: ['invoice.read', 'ledger.read', 'report.export'], at: t('08:04'), expires: t('12:00'), event: 'evt-del-0004' })
  b.delegate({ id: 'del-daniel-support', from: 'human-daniel', to: 'agent-support', granted: ['customer.read', 'ticket.read', 'ticket.write', 'email.draft'], at: t('08:30'), expires: t('19:00'), revoked: t('14:00'), restrictions: ['customer-region=EU'], event: 'evt-del-0005' })
  b.delegate({ id: 'del-support-lookup', from: 'agent-support', to: 'agent-lookup', parent: 'del-daniel-support', granted: ['customer.read'], at: t('08:31'), expires: t('19:00'), restrictions: ['read-only', 'customer-region=EU'], event: 'evt-del-0006' })
  b.delegate({ id: 'del-support-reply', from: 'agent-support', to: 'agent-reply', parent: 'del-daniel-support', granted: ['email.draft', 'ticket.read', 'customer.write'], at: t('08:32'), expires: t('19:00'), event: 'evt-del-0007' })
  b.delegate({ id: 'del-priya-triage', from: 'human-priya', to: 'agent-triage', granted: ['incident.read', 'log.read', 'ticket.read'], at: t('09:00'), expires: t('21:00'), policy: 'pol-security-agents', version: '3', event: 'evt-del-0008' })
  b.delegate({ id: 'del-tom-forecast', from: 'human-tom', to: 'agent-forecast', granted: ['crm.read', 'report.export'], at: t('09:15'), expires: '2026-10-10T00:00:00Z', version: null, event: 'evt-del-0009' })

  let n = 0
  const ev = () => `evt-${String(++n).padStart(4, '0')}`

  // ---- Maya's finance chain: healthy routine work through the morning
  const invoices = ['inv-88201', 'inv-88207', 'inv-88213', 'inv-88219', 'inv-88226', 'inv-88231']
  invoices.forEach((inv, i) => {
    const hh = String(9 + Math.floor(i / 2)).padStart(2, '0')
    const mm = i % 2 === 0 ? '05' : '35'
    b.act({ event: ev(), actor: 'agent-invoice', delegation: 'del-ops-invoice', root: 'human-maya', parent: 'agent-ops', at: t(`${hh}:${mm}`), tool: 'tool-invoice-lookup', resource: 'res-invoice-db', operation: 'read', exec: 'wl-invoice-07', credential: 'svid-invoice-07', requested: ['invoice.read'], exercised: ['invoice.read'], policy: 'pol-finance-agents', version: '12', parameters: { invoice_id: inv } })
  })
  b.act({ event: ev(), actor: 'agent-invoice', delegation: 'del-ops-invoice', root: 'human-maya', parent: 'agent-ops', at: t('10:42'), tool: 'tool-invoice-approve', resource: 'res-invoice-db', operation: 'approve', exec: 'wl-invoice-07', credential: 'svid-invoice-07', requested: ['invoice.approve'], exercised: ['invoice.approve'], policy: 'pol-finance-agents', version: '12', approval: 'APPROVED', parameters: { invoice_id: 'inv-88213', amount_eur: 18400 } })
  // privileged approval with no approval recorded
  b.act({ event: ev(), actor: 'agent-invoice', delegation: 'del-ops-invoice', root: 'human-maya', parent: 'agent-ops', at: t('11:18'), tool: 'tool-invoice-approve', resource: 'res-invoice-db', operation: 'approve', exec: 'wl-invoice-07', credential: 'svid-invoice-07', requested: ['invoice.approve'], exercised: ['invoice.approve'], policy: 'pol-finance-agents', version: '12', approval: 'PENDING', parameters: { invoice_id: 'inv-88226', amount_eur: 24950 } })

  for (const [i, hhmm] of ['09:20', '10:20', '11:20'].entries()) {
    b.act({ event: ev(), actor: 'agent-recon', delegation: 'del-ops-recon', root: 'human-maya', parent: 'agent-ops', at: t(hhmm), tool: 'tool-ledger-query', resource: 'res-ledger-db', operation: 'read', exec: 'wl-recon-04', credential: 'svid-recon-04', requested: ['ledger.read'], exercised: ['ledger.read'], policy: 'pol-finance-agents', version: '12', parameters: { period: '2026-09', batch: i + 1 } })
  }
  // ReconciliationAgent posts to the ledger: delegated read only, workload holds standing write
  b.act({ event: 'evt-0042', actor: 'agent-recon', delegation: 'del-ops-recon', root: 'human-maya', parent: 'agent-ops', at: t('11:47'), tool: 'tool-ledger-post', resource: 'res-ledger-db', operation: 'write', exec: 'wl-recon-04', credential: 'svid-recon-04', requested: ['ledger.read', 'ledger.write'], exercised: ['ledger.read', 'ledger.write'], policy: 'pol-finance-agents', version: '12', approval: 'APPROVED', reason: 'tool default credentials', parameters: { journal: 'JE-2026-0931', lines: 14 } })

  b.act({ event: ev(), actor: 'agent-report', delegation: 'del-ops-report', root: 'human-maya', parent: 'agent-ops', at: t('09:50'), tool: 'tool-report-export', resource: 'res-report-bucket', operation: 'export', exec: 'wl-report-02', credential: 'svid-report-02', requested: ['invoice.read', 'report.export'], exercised: ['invoice.read', 'report.export'], policy: 'pol-finance-agents', version: '12', parameters: { report: 'ap-aging-weekly' } })
  // ReportingAgent keeps running after its delegation expired at 12:00
  b.act({ event: ev(), actor: 'agent-report', delegation: 'del-ops-report', root: 'human-maya', parent: 'agent-ops', at: t('13:10'), tool: 'tool-report-export', resource: 'res-report-bucket', operation: 'export', exec: 'wl-report-02', credential: 'svid-report-02', requested: ['ledger.read', 'report.export'], exercised: ['ledger.read', 'report.export'], policy: 'pol-finance-agents', version: '12', parameters: { report: 'gl-trial-balance' } })
  // A batch job runs as a shared workload identity that is not issued to the acting agent
  b.act({ event: ev(), actor: 'agent-ops', delegation: 'del-maya-ops', root: 'human-maya', at: t('12:30'), tool: 'tool-ledger-query', resource: 'res-ledger-db', operation: 'read', exec: 'wl-shared-batch', credential: 'tok-batch-legacy', requested: ['ledger.read'], exercised: ['ledger.read'], policy: 'pol-finance-agents', version: '12', parameters: { query: 'open-items' } })

  // ---- Daniel's support chain
  const tickets = ['TCK-4410', 'TCK-4413', 'TCK-4417', 'TCK-4421', 'TCK-4429']
  tickets.forEach((tk, i) => {
    const at = t(`${String(9 + i).padStart(2, '0')}:12`)
    b.act({ event: ev(), actor: 'agent-lookup', delegation: 'del-support-lookup', root: 'human-daniel', parent: 'agent-support', at, tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-lookup-05', credential: 'svid-lookup-05', requested: ['customer.read'], exercised: ['customer.read'], policy: 'pol-support-agents', version: '5', parameters: { ticket: tk } })
    b.act({ event: ev(), actor: 'agent-support', delegation: 'del-daniel-support', root: 'human-daniel', at: t(`${String(9 + i).padStart(2, '0')}:20`), tool: 'tool-ticket-update', resource: 'res-ticket-system', operation: 'update', exec: 'wl-support-01', credential: 'svid-support-01', requested: ['ticket.write'], exercised: ['ticket.write'], policy: 'pol-support-agents', version: '5', parameters: { ticket: tk, status: 'pending-customer' } })
  })
  // ReplyDraftAgent was granted customer.write its delegator never held (latent amplification); it only drafts
  b.act({ event: ev(), actor: 'agent-reply', delegation: 'del-support-reply', root: 'human-daniel', parent: 'agent-support', at: t('10:45'), tool: 'tool-email-draft', resource: 'res-ticket-system', operation: 'draft', exec: 'wl-reply-03', credential: 'svid-reply-03', requested: ['email.draft'], exercised: ['email.draft'], policy: 'pol-support-agents', version: '5', parameters: { ticket: 'TCK-4413' } })
  // Daniel revoked SupportAgent at 14:00; at 14:40 SupportAgent updates a ticket on a decision cached at 13:30
  b.act({ event: 'evt-0901', actor: 'agent-support', delegation: 'del-daniel-support', root: 'human-daniel', at: t('14:40'), tool: 'tool-ticket-update', resource: 'res-ticket-system', operation: 'update', exec: 'wl-support-01', credential: 'svid-support-01', requested: ['ticket.write'], exercised: ['ticket.write'], policy: 'pol-support-agents', version: '5', evaluatedAt: t('13:30'), reason: 'session grant cache', parameters: { ticket: 'TCK-4433', status: 'closed' } })
  // ... and a lookup that the gateway correctly refused after revocation
  b.act({ event: ev(), actor: 'agent-lookup', delegation: 'del-support-lookup', root: 'human-daniel', parent: 'agent-support', at: t('14:55'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-lookup-05', credential: 'svid-lookup-05', requested: ['customer.read'], exercised: [], policy: 'pol-support-agents', version: '5', decision: 'DENY', reason: 'upstream delegation revoked', result: 'failure', parameters: { ticket: 'TCK-4433' } })
  // CustomerLookupAgent's credential revoked at 15:30 but used at 15:45 with action-time evaluation
  b.act({ event: ev(), actor: 'agent-lookup', delegation: 'del-support-lookup', root: 'human-daniel', parent: 'agent-support', at: t('15:45'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'read', exec: 'wl-lookup-05', credential: 'svid-lookup-05', requested: ['customer.read'], exercised: ['customer.read'], policy: 'pol-support-agents', version: '5', decision: 'ALLOW', parameters: { ticket: 'TCK-4440' } })

  // ---- Priya's security triage chain: clean
  for (const [i, hhmm] of ['09:30', '11:00', '13:30', '16:10'].entries()) {
    b.act({ event: ev(), actor: 'agent-triage', delegation: 'del-priya-triage', root: 'human-priya', at: t(hhmm), tool: 'tool-log-search', resource: 'res-log-store', operation: 'search', exec: 'wl-triage-01', credential: 'svid-triage-01', requested: ['log.read'], exercised: ['log.read'], policy: 'pol-security-agents', version: '3', parameters: { incident: `INC-20${31 + i}`, window: '1h' } })
  }

  // ---- Tom's forecast agent: delegation without policy version, and Tom leaves at 13:00
  b.act({ event: ev(), actor: 'agent-forecast', delegation: 'del-tom-forecast', root: 'human-tom', at: t('10:05'), tool: 'tool-crm-query', resource: 'res-crm', operation: 'read', exec: 'wl-forecast-01', credential: 'svid-forecast-01', requested: ['crm.read'], exercised: ['crm.read'], parameters: { pipeline: 'q4' } })
  b.act({ event: ev(), actor: 'agent-forecast', delegation: 'del-tom-forecast', root: 'human-tom', at: t('16:30'), tool: 'tool-report-export', resource: 'res-report-bucket', operation: 'export', exec: 'wl-forecast-01', credential: 'svid-forecast-01', requested: ['report.export'], exercised: ['report.export'], parameters: { report: 'q4-forecast' } })

  // ---- NightlySyncAgent: a scheduled agent no human ever delegated to
  b.act({ event: ev(), actor: 'agent-sync', at: t('02:15'), tool: 'tool-crm-query', resource: 'res-crm', operation: 'read', exec: 'wl-sync-09', credential: 'svid-sync-09', requested: null, exercised: ['crm.read'], version: null, evaluatedAt: null, reason: null, parameters: { mode: 'incremental' } })
  b.act({ event: ev(), actor: 'agent-sync', at: t('02:16'), tool: 'tool-customer-search', resource: 'res-customer-db', operation: 'write', exec: 'wl-sync-09', credential: 'svid-sync-09', requested: null, exercised: ['customer.write'], version: null, evaluatedAt: null, reason: null, parameters: { mode: 'incremental', records: 412 } })

  return b.build()
}
