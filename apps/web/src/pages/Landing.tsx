import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, GitBranch as Github } from 'lucide-react'
import { Mark, Wordmark } from '../brand/Logo'
import { IconAgent, IconAttribution, IconChain, IconEvidence, IconHuman, IconPolicy, IconReplay, IconResource, IconSubAgent, IconTool, IconVerification, IconViolation } from '../brand/icons'
import { useReducedMotion, useTheme } from '../lib/prefs'
import { AuthorityDiff, ScopeChips } from '../ui/scope'
import { cx } from '../ui/primitives'
import { AuthorityFlow } from '../viz/AuthorityFlow'
import type { FlowStage } from '../viz/model'

const REPO = 'https://github.com/Het-P301204/regent'

/* Illustrative data, taken from the shipped Acme demo dataset. */
const HEALTHY: FlowStage[] = [
  { id: 'maya', label: 'Maya Chen', role: 'Human principal', scope: ['invoice.read', 'invoice.write', 'invoice.approve', 'ledger.read', 'ledger.write', 'report.export'], excess: [], result: 'PASS' },
  { id: 'ops', label: 'OperationsAgent', role: 'Agent', scope: ['invoice.read', 'invoice.write', 'invoice.approve', 'ledger.read', 'report.export'], excess: [], result: 'PASS' },
  { id: 'inv', label: 'InvoiceAgent', role: 'Sub-agent', scope: ['invoice.read', 'invoice.approve'], excess: [], result: 'PASS' },
  { id: 'tool', label: 'InvoiceLookup', role: 'Exercised', scope: ['invoice.read'], excess: [], result: 'PASS' },
]
const AMPLIFIED: FlowStage[] = [
  HEALTHY[0]!,
  HEALTHY[1]!,
  { id: 'rec', label: 'ReconciliationAgent', role: 'Sub-agent', scope: ['ledger.read'], excess: [], result: 'PASS' },
  { id: 'tool', label: 'LedgerPost', role: 'Exercised', scope: ['ledger.read'], excess: ['ledger.write'], result: 'FAIL' },
]

export default function Landing() {
  const [theme] = useTheme()
  const [amplified, setAmplified] = useState(false)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (reduced) return
    const t = setInterval(() => setAmplified((a) => !a), 6500)
    return () => clearInterval(t)
  }, [reduced])
  useEffect(() => {
    document.title = 'REGENT — AI Agent Authority & Delegation Verification'
  }, [])

  return (
    <div className="min-h-screen bg-canvas text-ink" data-theme={theme}>
      <header className="sticky top-0 z-30 border-b hairline bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-5">
          <Link to="/" aria-label="REGENT home">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-1 text-[13px]" aria-label="Site">
            <a href="#how" className="hidden rounded px-3 py-1.5 text-ink-2 hover:text-ink md:block">How it works</a>
            <a href="#architecture" className="hidden rounded px-3 py-1.5 text-ink-2 hover:text-ink md:block">Architecture</a>
            <Link to="/docs" className="hidden rounded px-3 py-1.5 text-ink-2 hover:text-ink sm:block">Docs</Link>
            <a href={REPO} className="rounded px-3 py-1.5 text-ink-2 hover:text-ink" aria-label="GitHub repository"><Github size={16} /></a>
            <Link to="/app" className="ml-1 inline-flex h-8 items-center gap-1.5 rounded bg-copper px-3 text-[13px] font-medium text-[rgb(var(--canvas))] hover:bg-copper-ink">
              Explore the demo <ArrowRight size={14} />
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* 1. Hero */}
        <section className="relative overflow-hidden border-b hairline">
          <div className="dotgrid absolute inset-0 opacity-60" aria-hidden />
          <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-5 pb-20 pt-16 lg:grid-cols-[1fr_1.05fr] lg:pt-24">
            <div className="anim-fade-up">
              <div className="flex items-center gap-3">
                <Mark size={34} />
                <span className="font-mono text-[11px] tracking-[0.3em] text-ink-3">REGENT</span>
              </div>
              <h1 className="mt-8 font-display text-[54px] leading-[0.98] tracking-[-0.015em] text-ink sm:text-[72px]">
                Know who authorized
                <br />
                every agent action.
              </h1>
              <p className="mt-6 font-mono text-[13px] leading-7 text-ink-2">
                Trace delegation.
                <br />
                Verify authority.
                <br />
                Preserve accountability.
              </p>
              <p className="mt-6 max-w-[460px] text-[15px] leading-relaxed text-ink-2">
                REGENT reconstructs the authority chain behind AI-agent actions and verifies that delegated authority never silently expands.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/app" className="inline-flex h-10 items-center gap-2 rounded bg-copper px-4 text-[14px] font-medium text-[rgb(var(--canvas))] transition-colors hover:bg-copper-ink">
                  Explore the demo <ArrowRight size={15} />
                </Link>
                <a href="#architecture" className="inline-flex h-10 items-center rounded border border-[rgb(var(--line-strong)/0.2)] px-4 text-[14px] text-ink transition-colors hover:bg-s2">
                  View the architecture
                </a>
              </div>
            </div>
            <div className="anim-fade-up" style={{ animationDelay: '160ms' }}>
              <HeroChain amplified={amplified} />
              <div className="panel mt-4 px-4 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                  <span className="eyebrow">{amplified ? 'Same delegator, different branch' : 'Authority narrows at every hop'}</span>
                  <div role="radiogroup" aria-label="Example chain" className="flex rounded border hairline-strong p-0.5 text-[11.5px]">
                    {[false, true].map((a) => (
                      <button key={String(a)} role="radio" aria-checked={amplified === a} onClick={() => setAmplified(a)} className={cx('rounded-[3px] px-2.5 py-1 transition-colors', amplified === a ? (a ? 'bg-crimson/20 text-crimson-ink' : 'bg-sage/15 text-sage-ink') : 'text-ink-3 hover:text-ink-2')}>
                        {a ? '✕ Amplified' : '✓ Healthy'}
                      </button>
                    ))}
                  </div>
                </div>
                <AuthorityFlow key={String(amplified)} stages={amplified ? AMPLIFIED : HEALTHY} height={220} />
              </div>
              <p className="mt-2 font-mono text-[10.5px] text-ink-4">Illustration from the synthetic Acme AI Operations demo dataset.</p>
            </div>
          </div>
        </section>

        {/* 2. Problem */}
        <Section id="problem" eyebrow="The problem" title="An agent's action carries someone's authority. Usually nobody can say whose.">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <Prose title="Agents act as service accounts">Most agent actions reach their target under a generic workload identity. The log says what ran. It does not say which person authorized it, through which agents, or under what limits.</Prose>
            <Prose title="Sub-agents are delegation events">An agent that spawns a sub-agent is handing on authority. When that hand-off is not recorded with an explicit scope, the chain breaks and nothing downstream is attributable.</Prose>
            <Prose title="Amplification has no single author">A read-only grant, a tool with standing write access and an agent that asks for both can produce a write that no component authorized. That is a confused deputy spread across a chain.</Prose>
          </div>
        </Section>

        {/* 3. Delegation visualization */}
        <Section id="delegation" eyebrow="Delegation chain" title="Three structures, kept apart.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Structure icon={<IconChain size={18} />} title="Delegation chain" q="Who delegated authority to whom?" rows={['Maya Chen', 'OperationsAgent', 'InvoiceAgent']} rel="DELEGATES" />
            <Structure icon={<IconTool size={18} />} title="Execution path" q="How did the action reach the target?" rows={['InvoiceAgent', 'InvoiceLookup', 'wl-invoice-07', 'InvoiceDB']} rel="INVOKES · EXECUTES AS · TARGETS" />
            <Structure icon={<IconEvidence size={18} />} title="Evidence chain" q="Which records prove it?" rows={['action event', 'delegation events', 'identities', 'policy v12', 'credential binding']} rel="RECORDED BY" />
          </div>
          <p className="mt-6 max-w-2xl text-[14px] leading-relaxed text-ink-2">Only principals hold and pass on authority. Tools, execution identities, credentials and resources take part in the action but are never delegation hops — collapsing them into one chain is how authority gets lost.</p>
        </Section>

        {/* 4. How it works: a real sequence, so it is numbered */}
        <Section id="how" eyebrow="How REGENT works" title="From raw records to a deterministic verdict.">
          <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-md border hairline bg-[rgb(var(--line)/0.08)] sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Ingest', 'JSON or JSONL from your agent platform, treated as untrusted evidence. Bad records are rejected with a reason; legacy field names are rewritten.'],
              ['Reconstruct', 'Each action is walked back through recorded parent delegations to a root principal. A link that cannot be followed breaks the chain; nothing is guessed.'],
              ['Verify', 'Ten invariants: containment, contraction, attribution, identity binding, action-time validity, policy traceability, approval. Unknown is never PASS.'],
              ['Explain', 'Findings name the first broken edge, the authority that appeared from nowhere, and the evidence records behind every claim.'],
            ].map(([t, b], i) => (
              <li key={t} className="bg-s1 p-6">
                <span className="font-mono text-[11px] text-copper-ink">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-3 text-[16px] font-medium">{t}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{b}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* 5. Authority monotonicity */}
        <Section id="monotonicity" eyebrow="Authority monotonicity" title="Authority may contract. It may never silently expand.">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="font-mono text-[15px] leading-8 text-ink">
                Exercised ⊆ Effective
                <br />
                Effective ⊆ Granted
                <br />
                Granted ⊆ Effective(delegator)
              </p>
              <p className="mt-4 text-[14px] leading-relaxed text-ink-2">REGENT checks each line separately, because each one fails for a different reason: a tool fell back to its workload's standing permissions, a policy ceiling was ignored, or a delegator granted something it never held.</p>
            </div>
            <div className="panel p-5">
              <div className="eyebrow mb-3">Authority diff · ReconciliationAgent posts to the ledger</div>
              <AuthorityDiff available={['invoice.read', 'invoice.write', 'invoice.approve', 'ledger.read', 'report.export']} granted={['ledger.read']} requested={['ledger.read', 'ledger.write']} effective={['ledger.read']} exercised={['ledger.read', 'ledger.write']} excess={['ledger.write']} />
            </div>
          </div>
        </Section>

        {/* 6–8. Attribution, replay, findings */}
        <Section id="capabilities" eyebrow="Investigation" title="Built for the moment someone asks who did this.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Feature icon={<IconAttribution size={20} />} title="Attribution">Every action resolves to a root principal or is reported as unattributable — with the exact missing link. Missing evidence is never presented as misuse.</Feature>
            <Feature icon={<IconReplay size={20} />} title="Chain replay">Step through an action from the first delegation to the resource access, using only recorded timestamps. The replay stops on the edge where the invariant broke.</Feature>
            <Feature icon={<IconViolation size={20} />} title="Findings">Sixteen deterministic finding types with stable ids, authority deltas, root cause, remediation and an evidence locker of content-hashed records.</Feature>
          </div>
          <div className="mt-6 panel overflow-hidden">
            <div className="grid grid-cols-1 divide-y hairline md:grid-cols-[1fr_1.4fr] md:divide-x md:divide-y-0">
              <div className="p-5">
                <div className="eyebrow">Locate the broken edge</div>
                <ul className="mt-4 space-y-3 text-[13px]">
                  {[
                    ['Maya Chen', 'PASS'],
                    ['OperationsAgent', 'PASS'],
                    ['ReconciliationAgent', 'PASS'],
                    ['LedgerPost', 'FAIL'],
                  ].map(([n, r], i) => (
                    <li key={n} className="flex items-center gap-3">
                      <span className={cx('flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px]', r === 'FAIL' ? 'border-crimson text-crimson-ink' : 'border-sage text-sage-ink')}>{r === 'FAIL' ? '✕' : '✓'}</span>
                      <span className={r === 'FAIL' ? 'text-crimson-ink' : 'text-ink'}>{n}</span>
                      {i === 3 ? <span className="font-mono text-[10px] tracking-[0.12em] text-crimson-ink">← FIRST BROKEN EDGE</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-5">
                <div className="eyebrow">Why is this a finding?</div>
                <p className="mt-3 font-display text-[22px] leading-snug">ReconciliationAgent exercised ledger.write, which no delegation in its chain legitimately conveyed.</p>
                <p className="mt-3 text-[13px] leading-relaxed text-ink-2">OperationsAgent passed only ledger.read. The execution identity wl-recon-04 holds standing ledger.write, and the tool used it. Authority expanded across a delegation boundary.</p>
              </div>
            </div>
          </div>
        </Section>

        {/* 9. Scenario lab */}
        <Section id="lab" eyebrow="Scenario lab" title="Twelve synthetic scenarios, one property each.">
          <ul className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {['Valid single-agent delegation', 'Valid multi-agent delegation', 'Broken parent chain', 'Authority amplification', 'Missing delegated user', 'Credential mismatch', 'Revoked credential', 'Stale delegation', 'Sub-agent receives excessive scope', 'Missing policy version', 'Action-time authorization failure', 'Complex multi-agent chain'].map((s, i) => (
              <li key={s} className="flex items-baseline gap-3 border-b hairline py-2.5 text-[13.5px]">
                <span className="w-5 font-mono text-[11px] text-ink-3">{i + 1}</span>
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[13px] text-ink-2">Every identity and credential is invented. The test suite enforces that each scenario produces exactly the findings it is designed to teach — no more, no fewer.</p>
        </Section>

        {/* 10. Standards */}
        <Section id="standards" eyebrow="Standards" title="Built on existing delegation semantics, not a new protocol.">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border hairline bg-[rgb(var(--line)/0.08)] md:grid-cols-3 lg:grid-cols-6">
            {[
              ['OAuth 2.x', 'Token exchange actor claims → delegation hops'],
              ['OpenID Connect', 'ID token subject → human principal'],
              ['SPIFFE/SPIRE', 'SVID → execution identity + credential binding'],
              ['SCIM', 'Provisioned entitlements → provisioned scope'],
              ['NGAC', 'Policy class → scope ceiling'],
              ['MCP', 'Tool invocation → INVOKES edge'],
            ].map(([n, d]) => (
              <div key={n} className="bg-s1 p-4">
                <div className="text-[13px] font-medium">{n}</div>
                <div className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{d}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 max-w-3xl text-[12.5px] text-ink-3">These are the six standards the NIST NCCoE concept paper on AI agent identity and authorization (Feb 2026) points to. The mappings are conceptual; REGENT does not claim conformance with any of them.</p>
        </Section>

        {/* 11. Architecture */}
        <Section id="architecture" eyebrow="Architecture" title="The engine decides. Everything else displays.">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="panel overflow-x-auto p-5">
              <pre className="font-mono text-[12px] leading-6 text-ink-2">{`  Ingestion ─▶ Normalization ─▶ Identity resolution
                                       │
  Chain reconstruction ◀───────────────┘
        │
        ▼
  Scope resolution ─▶ Policy evaluation ─▶ Invariant verification
                                                  │
  Finding generation ◀────────────────────────────┘
        │
        ├─▶ API (Hono, PostgreSQL)  ─▶  Console (visualization only)
        └─▶ CLI (same engine, offline)`}</pre>
            </div>
            <ul className="space-y-4 text-[13.5px] leading-relaxed text-ink-2">
              <li><span className="text-ink">@regent/core</span> — a pure TypeScript engine: no I/O, no clock, no randomness. Same input, byte-identical output, checked by tests that shuffle the records.</li>
              <li><span className="text-ink">API</span> — stores evidence relationally in PostgreSQL (PGlite locally), re-verifies from storage, and serves reports. The web console never computes a verdict.</li>
              <li><span className="text-ink">CLI</span> — <code className="font-mono text-[12px]">regent analyze events.json</code> prints the same input digest the API records for the same file.</li>
            </ul>
          </div>
        </Section>

        {/* 12. Security */}
        <Section id="security" eyebrow="Security" title="An accountability tool, not an attack platform.">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            <ul className="space-y-2.5 text-[13.5px] text-ink-2">
              {['Imported records are untrusted evidence: schema-validated, size-limited, and never executed', 'Credential metadata only — no secret material is stored or accepted', 'Session cookies are HttpOnly and SameSite=Strict, with a CSRF token on every mutation', 'Every query is scoped to an organization; roles gate imports, rules and reports', 'Content-hashed evidence: change is detectable; the hashes are not claimed to be signatures'].map((s) => (
                <li key={s} className="flex gap-3"><span className="text-sage-ink" aria-hidden>✓</span>{s}</li>
              ))}
            </ul>
            <div className="panel p-5">
              <div className="eyebrow">Out of scope, by design</div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">REGENT does not enforce authorization, call real tools, test external targets or hold real credentials. It verifies records. Every scenario and the demo environment are synthetic.</p>
            </div>
          </div>
        </Section>

        {/* 13–14. Docs & GitHub */}
        <Section id="docs" eyebrow="Documentation" title="Run it, read it, verify it yourself.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <LinkCard to="/docs" icon={<IconPolicy size={18} />} title="Documentation" body="Concepts, delegation and authority models, the verification engine, policy rules, threat model." />
            <LinkCard to="/docs/api" icon={<IconVerification size={18} />} title="API & CLI" body="OpenAPI reference, bearer tokens for automation, and the regent CLI with CI exit codes." />
            <a href={REPO} className="panel group block p-5 transition-colors hover:bg-s2">
              <Github size={18} className="text-ink-2" />
              <div className="mt-3 text-[14px] font-medium">Source on GitHub</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">Apache-2.0. Monorepo with the engine, API, console, CLI, scenarios and adversarial test datasets.</p>
            </a>
          </div>
        </Section>
      </main>

      {/* 15. Footer */}
      <footer className="border-t hairline">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <div className="flex flex-wrap gap-4 text-[12px] text-ink-3">
            <Link to="/docs" className="hover:text-ink">Docs</Link>
            <Link to="/docs/security" className="hover:text-ink">Security model</Link>
            <a href={REPO} className="hover:text-ink">GitHub</a>
            <Link to="/app" className="hover:text-ink">Console</Link>
            <span>Synthetic demo data. No real identities.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function HeroChain({ amplified }: { amplified: boolean }) {
  const nodes = [
    { icon: IconHuman, name: 'Maya Chen', role: 'Human principal', scope: ['invoice.*', 'ledger.*', 'report.export'] },
    { icon: IconAgent, name: 'OperationsAgent', role: 'Agent', scope: ['invoice.read', 'invoice.approve', 'ledger.read'] },
    amplified ? { icon: IconSubAgent, name: 'ReconciliationAgent', role: 'Sub-agent', scope: ['ledger.read'] } : { icon: IconSubAgent, name: 'InvoiceAgent', role: 'Sub-agent', scope: ['invoice.read', 'invoice.approve'] },
    amplified ? { icon: IconTool, name: 'LedgerPost', role: 'Tool', scope: ['ledger.read', 'ledger.write'] } : { icon: IconTool, name: 'InvoiceLookup', role: 'Tool', scope: ['invoice.read'] },
    amplified ? { icon: IconResource, name: 'LedgerDB', role: 'Resource', scope: [] } : { icon: IconResource, name: 'InvoiceDB', role: 'Resource', scope: [] },
  ]
  const rel = ['DELEGATES', 'DELEGATES', 'INVOKES', 'TARGETS']
  return (
    <ol className="panel relative px-5 py-4" aria-label="Example delegation chain">
      {nodes.map((n, i) => (
        <li key={`${amplified}-${n.name}`} className="anim-fade-up" style={{ animationDelay: `${i * 140}ms` }}>
          <div className="flex items-center gap-3">
            <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', i < 3 ? 'bg-copper/12 text-copper-ink' : 'bg-s3 text-ink-2')}>
              <n.icon size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">{n.role}</span>
              <span className="block text-[14px] text-ink">{n.name}</span>
            </span>
            <span className="hidden sm:block">
              <ScopeChips scope={n.scope} highlight={amplified && i === 3 ? ['ledger.write'] : []} empty="" />
            </span>
          </div>
          {i < nodes.length - 1 ? (
            <div className="ml-[15px] flex items-center gap-3 border-l py-1.5 pl-6" style={{ borderColor: amplified && i === 2 ? 'rgb(var(--crimson))' : 'rgb(var(--line-strong) / 0.18)' }}>
              <span className={cx('font-mono text-[9.5px] tracking-[0.14em]', amplified && i === 2 ? 'text-crimson-ink' : 'text-ink-4')}>
                {amplified && i === 2 ? '✕ ' : ''}
                {rel[i]}
              </span>
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 border-b hairline">
      <div className="mx-auto max-w-[1200px] px-5 py-20">
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="mt-3 max-w-3xl font-display text-[38px] leading-[1.08] tracking-[-0.01em] sm:text-[44px]">{title}</h2>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  )
}

function Prose({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[15px] font-medium">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

function Structure({ icon, title, q, rows, rel }: { icon: React.ReactNode; title: string; q: string; rows: string[]; rel: string }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 text-copper-ink">{icon}<span className="text-[14px] font-medium text-ink">{title}</span></div>
      <p className="mt-1 text-[12.5px] text-ink-3">{q}</p>
      <ol className="mt-4 space-y-1.5">
        {rows.map((r, i) => (
          <li key={r} className="flex items-center gap-2 font-mono text-[12px] text-ink-2">
            <span className="text-ink-4">{i === 0 ? '●' : '↓'}</span>
            {r}
          </li>
        ))}
      </ol>
      <div className="mt-4 font-mono text-[9.5px] tracking-[0.14em] text-ink-4">{rel}</div>
    </div>
  )
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5 transition-colors hover:bg-s2">
      <span className="text-copper-ink">{icon}</span>
      <h3 className="mt-3 text-[15px] font-medium">{title}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

function LinkCard({ to, icon, title, body }: { to: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <Link to={to} className="panel group block p-5 transition-colors hover:bg-s2">
      <span className="text-copper-ink">{icon}</span>
      <div className="mt-3 flex items-center gap-1.5 text-[14px] font-medium">
        {title} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{body}</p>
    </Link>
  )
}

