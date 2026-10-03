import type { SVGProps } from 'react'

/**
 * REGENT icon set. One geometry for every glyph: 20-unit grid, 1.5 stroke,
 * round joins; principals are rounded forms, non-principals are angular.
 * Humans are circles, agents hexagons, execution things squares, targets
 * cylinders. A glyph never carries meaning by colour alone.
 */
type P = SVGProps<SVGSVGElement> & { size?: number; title?: string }

function Svg({ size = 16, title, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} {...rest}>
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export const IconHuman = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="7" r="3.2" />
    <path d="M4 17c.8-3.2 3.2-5 6-5s5.2 1.8 6 5" />
  </Svg>
)

export const IconAgent = (p: P) => (
  <Svg {...p}>
    <path d="M10 2.5l6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5z" />
    <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconSubAgent = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.5l4.5 2.6v5.2L8 12.9 3.5 10.3V5.1z" opacity="0.55" />
    <path d="M12.5 8.6l4 2.3v4.6l-4 2.3-4-2.3v-4.6z" />
  </Svg>
)

export const IconDelegation = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="4.5" r="2" />
    <circle cx="14" cy="15.5" r="2" />
    <path d="M6 6.5v3.5a3 3 0 0 0 3 3h3.2" />
    <path d="M10.6 11.4l1.8 1.6-1.8 1.6" />
  </Svg>
)

export const IconAuthority = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <circle cx="10" cy="10" r="4.5" strokeDasharray="1.5 2" />
    <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconScope = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 3.5C5 3.5 4.5 4.3 4.5 5.5v2.2c0 1-.6 1.8-1.5 2.3.9.5 1.5 1.3 1.5 2.3v2.2c0 1.2.5 2 2 2" />
    <path d="M13.5 3.5c1.5 0 2 .8 2 2v2.2c0 1 .6 1.8 1.5 2.3-.9.5-1.5 1.3-1.5 2.3v2.2c0 1.2-.5 2-2 2" />
    <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconCredential = (p: P) => (
  <Svg {...p}>
    <path d="M3 6.5l4-3.5h10v14H7l-4-3.5z" />
    <circle cx="7" cy="10" r="1.5" />
    <path d="M10.5 8h4M10.5 12h3" />
  </Svg>
)

export const IconPolicy = (p: P) => (
  <Svg {...p}>
    <path d="M5 2.5h7.5L15.5 5.5v12H5z" />
    <path d="M12 2.5v3.5h3.5" />
    <path d="M11.5 9.5c-.4-.7-1-1-1.8-1-1 0-1.7.6-1.7 1.3 0 1.6 3.6 1 3.6 2.8 0 .8-.8 1.4-1.9 1.4-.8 0-1.5-.4-1.8-1" />
  </Svg>
)

export const IconTool = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="6" width="9" height="8" rx="1" />
    <path d="M12 8.5h2.5M12 11.5h2.5M14.5 7v6" />
    <path d="M14.5 10H17" />
  </Svg>
)

export const IconExecution = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" />
    <path d="M7 10h6M10 7v6" />
  </Svg>
)

export const IconResource = (p: P) => (
  <Svg {...p}>
    <ellipse cx="10" cy="5" rx="6" ry="2.2" />
    <path d="M4 5v10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5" />
    <path d="M4 10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2" />
  </Svg>
)

export const IconChain = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="3.5" r="1.8" />
    <circle cx="10" cy="10" r="1.8" />
    <circle cx="10" cy="16.5" r="1.8" />
    <path d="M10 5.3v2.9M10 11.8v2.9" />
  </Svg>
)

export const IconViolation = (p: P) => (
  <Svg {...p}>
    <path d="M10 2.5l7.5 7.5-7.5 7.5L2.5 10z" />
    <path d="M10 6.5v4.5" />
    <circle cx="10" cy="13.6" r=".8" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconAttribution = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="4" r="2" />
    <path d="M10 6v4" strokeDasharray="1.4 1.6" />
    <path d="M10 10l-4.5 5M10 10l4.5 5" />
    <circle cx="5" cy="16" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="15" cy="16" r="1.4" />
  </Svg>
)

export const IconVerification = (p: P) => (
  <Svg {...p}>
    <path d="M10 2.2l2 1.5 2.5-.2.8 2.4 2.1 1.4-.8 2.4.8 2.4-2.1 1.4-.8 2.4-2.5-.2-2 1.5-2-1.5-2.5.2-.8-2.4L2.6 12.1l.8-2.4-.8-2.4 2.1-1.4.8-2.4 2.5.2z" />
    <path d="M7.3 10.2l1.9 1.8 3.6-3.8" />
  </Svg>
)

export const IconEvidence = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3" width="13" height="14" rx="1.5" />
    <path d="M6.5 7h7M6.5 10h7M6.5 13h4" />
  </Svg>
)

export const IconReplay = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
    <path d="M3.5 3v3.5H7" />
    <path d="M8.5 7.5v5l4-2.5z" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4l2.5 2" />
  </Svg>
)

export const PRINCIPAL_ICON = { human: IconHuman, agent: IconAgent, sub_agent: IconSubAgent, workload: IconExecution, service: IconExecution } as const
