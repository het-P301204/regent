import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Mark } from '../brand/Logo'
import { IconAuthority, IconDelegation, IconHuman, IconVerification, IconViolation } from '../brand/icons'
import { markOnboardingSeen } from '../lib/prefs'
import { Modal } from '../ui/overlay'
import { Button, cx } from '../ui/primitives'
import { AuthorityFlow } from '../viz/AuthorityFlow'

const STEPS = [
  {
    icon: IconHuman,
    title: 'Identities',
    body: 'Every action starts with a principal: a person, or an agent acting for one. Tools, workload identities, credentials and resources take part in the action but never hold authority of their own.',
  },
  {
    icon: IconDelegation,
    title: 'Delegation',
    body: 'A delegation passes a granted scope from a delegator to a delegatee. Spawning a sub-agent is a delegation. A chain of delegation hops connects the person who authorized the work to the agent that did it.',
  },
  {
    icon: IconAuthority,
    title: 'Authority',
    body: 'Authority should only narrow as it moves down the chain. A delegatee can never hold more than its delegator, and an action can never use more than its effective scope.',
  },
  {
    icon: IconVerification,
    title: 'Verification',
    body: 'REGENT rebuilds each chain from the records and checks it with deterministic rules. The same evidence always gives the same result, and missing evidence is reported as missing, never assumed fine.',
  },
  {
    icon: IconViolation,
    title: 'Findings',
    body: 'When an invariant breaks, REGENT names the exact edge where it broke, shows the authority that appeared from nowhere, and links every claim to the evidence record behind it.',
  },
]

export function Onboarding({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const [step, setStep] = useState(-1)
  const done = (to?: string) => {
    markOnboardingSeen()
    onClose()
    if (to) nav(to)
  }
  return (
    <Modal open onClose={() => done()} className="max-w-2xl" labelledBy="onb-title">
      {step === -1 ? (
        <div className="px-8 pb-8 pt-9">
          <Mark size={46} />
          <h2 id="onb-title" className="mt-5 font-display text-[38px] leading-[1.05] text-ink">
            Welcome to REGENT
          </h2>
          <p className="mt-2 max-w-md text-[14px] text-ink-2">Understand who authorized every agent action, and whether authority stayed within what was granted at every hop.</p>
          <div className="mt-6 rounded border hairline bg-canvas px-3 pt-2">
            <AuthorityFlow
              compact
              height={150}
              stages={[
                { id: 'a', label: 'Maya Chen', role: 'Human', scope: ['invoice.read', 'invoice.write', 'invoice.approve', 'ledger.read', 'report.export'], excess: [], result: 'PASS' },
                { id: 'b', label: 'OperationsAgent', role: 'Agent', scope: ['invoice.read', 'invoice.approve', 'ledger.read'], excess: [], result: 'PASS' },
                { id: 'c', label: 'InvoiceAgent', role: 'Sub-agent', scope: ['invoice.read', 'invoice.approve'], excess: [], result: 'PASS' },
                { id: 'd', label: 'InvoiceLookup', role: 'Exercised', scope: ['invoice.read'], excess: [], result: 'PASS' },
              ]}
            />
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => done('/app')}>
              Explore demo environment
            </Button>
            <Button onClick={() => done('/app/import')}>Import your events</Button>
            <Button onClick={() => done('/app/builder')}>Build a chain</Button>
            <Button variant="ghost" onClick={() => setStep(0)}>
              Take the 1-minute tour
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-8 pb-7 pt-8">
          <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span key={i} className={cx('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-copper' : 'bg-s3')} />
            ))}
          </div>
          {(() => {
            const s = STEPS[step]!
            return (
              <div key={step} className="anim-fade-up">
                <div className="mt-6 flex h-11 w-11 items-center justify-center rounded-full bg-copper/12 text-copper-ink">
                  <s.icon size={22} />
                </div>
                <div className="eyebrow mt-4">
                  {step + 1} / {STEPS.length}
                </div>
                <h2 id="onb-title" className="mt-1 font-display text-[32px] leading-tight text-ink">
                  {s.title}
                </h2>
                <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-2">{s.body}</p>
              </div>
            )
          })()}
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" onClick={() => (step === 0 ? setStep(-1) : setStep(step - 1))}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => setStep(step + 1)}>
                Next
              </Button>
            ) : (
              <Button variant="primary" onClick={() => done('/app')}>
                Open the command center
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
