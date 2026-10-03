/**
 * Renders the raster brand assets from the SVG sources with headless Chromium:
 *   favicon-16/32/48.png (packed into favicon.ico by scripts/make-ico.py),
 *   apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png,
 *   og-image.png (1200x630 social preview).
 *   node scripts/render-assets.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const pub = join(import.meta.dirname, '..', 'apps', 'web', 'public')
const favicon = readFileSync(join(pub, 'favicon.svg'), 'utf8')
const mark = readFileSync(join(pub, 'mark.svg'), 'utf8')
const fontDir = join(import.meta.dirname, '..', 'node_modules', '@fontsource')
const font = (pkg: string, file: string) => `data:font/woff2;base64,${readFileSync(join(fontDir, pkg, 'files', file)).toString('base64')}`

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

async function shot(html: string, w: number, h: number, out: string) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`)
  await page.evaluate(() => document.fonts.ready)
  writeFileSync(join(pub, out), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }))
  console.log('wrote', out)
}

const svgAt = (svg: string, size: number) => svg.replace('<svg ', `<svg width="${size}" height="${size}" `)
for (const s of [16, 32, 48]) await shot(svgAt(favicon, s), s, s, `favicon-${s}.png`)
await shot(svgAt(favicon, 180), 180, 180, 'apple-touch-icon.png')
await shot(svgAt(favicon, 192), 192, 192, 'icon-192.png')
await shot(svgAt(favicon, 512), 512, 512, 'icon-512.png')
// Maskable: full-bleed background, mark inside the 80% safe zone.
await shot(`<div style="width:512px;height:512px;background:#151514;display:flex;align-items:center;justify-content:center">${svgAt(favicon.replace('<rect width="64" height="64" rx="14" fill="#151514"/>', ''), 360)}</div>`, 512, 512, 'icon-maskable-512.png')

const og = `
<style>
@font-face{font-family:'Instrument Serif';src:url(${font('instrument-serif', 'instrument-serif-latin-400-normal.woff2')})}
@font-face{font-family:'Plex';src:url(${font('ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2')})}
@font-face{font-family:'PlexMono';src:url(${font('ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2')})}
.c{width:1200px;height:630px;background:#0D0D0C;color:#E9E4D8;position:relative;overflow:hidden;font-family:Plex}
.grid{position:absolute;inset:0;background-image:radial-gradient(rgba(233,228,216,.07) 1px,transparent 1px);background-size:22px 22px}
</style>
<div class="c"><div class="grid"></div>
  <div style="position:absolute;left:84px;top:78px;display:flex;align-items:center;gap:16px">${svgAt(mark, 54)}<span style="font-family:PlexMono;letter-spacing:.32em;font-size:18px;color:#B7AA91">REGENT</span></div>
  <div style="position:absolute;left:84px;top:180px;font-family:'Instrument Serif';font-size:84px;line-height:.98;letter-spacing:-.01em">Know who authorized<br/>every agent action.</div>
  <div style="position:absolute;left:86px;top:392px;font-family:PlexMono;font-size:19px;line-height:1.75;color:#B7AA91">Trace delegation. Verify authority.<br/>Preserve accountability.</div>
  <svg style="position:absolute;left:600px;top:430px" width="560" height="140" viewBox="0 0 560 140">
    <defs><pattern id="h" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="7" height="7" fill="rgba(169,61,52,.25)"/><line x1="0" y1="0" x2="0" y2="7" stroke="#E27062" stroke-width="2.4"/></pattern></defs>
    <path d="M20,30 C80,30 80,42 140,42 L140,98 C80,98 80,110 20,110Z" fill="rgba(196,122,68,.5)"/>
    <path d="M140,42 C200,42 200,58 260,58 L260,82 C200,82 200,98 140,98Z" fill="rgba(196,122,68,.4)"/>
    <path d="M260,58 C320,58 320,62 380,62 L380,78 C320,78 320,82 260,82Z" fill="rgba(196,122,68,.32)"/>
    <path d="M260,58 C320,58 320,36 380,36 L380,62 C320,62 320,58 260,58Z" fill="url(#h)" stroke="#E27062"/>
    <rect x="15" y="30" width="10" height="80" rx="2" fill="#C47A44"/><rect x="135" y="42" width="10" height="56" rx="2" fill="#C47A44"/>
    <rect x="255" y="58" width="10" height="24" rx="2" fill="#C47A44"/><rect x="375" y="62" width="10" height="16" rx="2" fill="#C47A44"/>
    <rect x="375" y="36" width="10" height="26" rx="2" fill="url(#h)" stroke="#E27062"/>
    <text x="400" y="54" font-family="PlexMono" font-size="13" fill="#E27062">+ ledger.write</text>
  </svg>
  <div style="position:absolute;left:84px;bottom:58px;font-family:PlexMono;font-size:14px;color:#8A8274">Authority, traced.</div>
</div>`
await shot(og, 1200, 630, 'og-image.png')
await browser.close()
