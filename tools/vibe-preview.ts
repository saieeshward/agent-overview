import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { C, CAST, FONT, FPS, OFFICE_ACCENTS, OFFICE_CAST, PALETTE, PROVIDER_NAMES, ROOM, SVG_MAX, canvas, sprite, toCells, toRGBA, toSvg } from '../hooks/vibe/engine'
import type { Canvas, HudLine } from '../hooks/vibe/engine'
import { FIXTURES } from '../hooks/vibe/fixtures'
import { SCENES } from '../hooks/vibe/scenes'
import { DESKS, MASCOTS } from '../hooks/vibe/office'
import { SHIPS } from '../hooks/vibe/arcade'

const [style, outdir] = process.argv.slice(2)
if ((style !== 'office' && style !== 'arcade') || !outdir || process.argv.length !== 4) {
  process.stderr.write('Usage: npx -y tsx tools/vibe-preview.ts <office|arcade> <outdir>\n')
  process.exit(2)
}

const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type), body = Buffer.concat([name, data]), crc = Buffer.alloc(4), size = Buffer.alloc(4)
  let c = 0xFFFFFFFF
  for (const b of body) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8)
  crc.writeUInt32BE((c ^ 0xFFFFFFFF) >>> 0)
  size.writeUInt32BE(data.length)
  return Buffer.concat([size, body, crc])
}
function png(c: Canvas, theme: 'dark' | 'light' = 'dark'): Buffer {
  const scale = 6, width = c.w * scale, height = c.h * scale
  return pngRGBA(toRGBA(c, scale, theme), width, height)
}
function pngRGBA(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4, rows = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!)
// Keep HUD proofs as real font text, separate from the pixel scene, just like both live surfaces.
function hudProof(name: string, columns: number, theme: 'dark' | 'light', rgba: Uint8Array, imageHeight: number) {
  const hud = SCENES[style as 'office' | 'arcade'].hud!(FIXTURES[name as keyof typeof FIXTURES], columns)
  const width = columns * 8 + 24, artTop = 14 + hud.top.length * 20
  const artHeight = imageHeight * 8, height = artTop + artHeight + 14 + hud.bottom.length * 20
  const ink = theme === 'dark' ? '#E6E6E6' : '#111111', paper = theme === 'dark' ? '#0B0B0B' : '#FAFAFA'
  const rows = (lines: HudLine[], top: number) => lines.map((line, i) => `<text x="12" y="${top + i * 20}" xml:space="preserve">${line.map(s => `<tspan fill="${s.color || ink}"${s.bold ? ' font-weight="bold"' : ''}${s.dim ? ' opacity=".65"' : ''}>${escapeXml(s.text)}</tspan>`).join('')}</text>`).join('')
  const raster = pngRGBA(rgba, columns * 6, imageHeight * 6).toString('base64')
  const proof = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="font:13px Menlo,monospace"><rect width="100%" height="100%" fill="${paper}"/>${rows(hud.top, 24)}<image x="12" y="${artTop}" width="${columns * 8}" height="${artHeight}" style="image-rendering:pixelated" href="data:image/png;base64,${raster}"/>${rows(hud.bottom, artTop + artHeight + 24)}</svg>`
  writeFileSync(join(outdir!, `${name}-hud${columns}-${theme}.svg`), proof)
}

mkdirSync(outdir, { recursive: true })
const scene = SCENES[style]
const contacts: { name: string; rgba: Uint8Array }[] = [], originals: typeof contacts = []
const cards: string[] = []
const lightContacts: typeof contacts = []
let sceneW = 0, sceneH = 0
const terminals = new Map<string, { name: string; rgba: Uint8Array }[]>()
for (const [name, d] of Object.entries(FIXTURES)) {
  const frames = scene.frames(d, { motion: 'full' })
  sceneW = frames[0]!.w; sceneH = frames[0]!.h
  frames.forEach((c, i) => {
    writeFileSync(join(outdir, `${name}-${String(i).padStart(2, '0')}.png`), png(c))
    if (style === 'arcade') writeFileSync(join(outdir, `${name}-${String(i).padStart(2, '0')}-light.png`), png(c, 'light'))
  })
  if (style === 'arcade') lightContacts.push({ name, rgba: toRGBA(frames[0]!, 6, 'light') })
  contact(`${name}-motion.png`, frames.map((c, i) => ({ name: `${name} ${String(i).padStart(2, '0')}`, rgba: toRGBA(c, 6) })), sceneW * 6, sceneH * 6)
  const themes = style === 'arcade' ? ['dark', 'light'] as const : ['dark'] as const
  for (const columns of [64, 100, 128]) for (const theme of themes) {
    const cells = toCells(scene.frames(d, { motion: 'still', width: columns })[0]!, columns, scene.focus?.(d, { width: columns })), bytes = Buffer.from(cells.cells, 'base64')
    const width = cells.columns * 6, height = cells.rows * 2 * 6, rgba = new Uint8Array(width * height * 4)
    let terminal = ''
    for (let i = 0; i < cells.columns * cells.rows; i++) terminal += String.fromCodePoint(bytes.readUInt32LE(i * 12)) + (i % cells.columns === cells.columns - 1 ? '\n' : '')
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = Math.floor(x / 6), py = Math.floor(y / 6), cell = (Math.floor(py / 2) * cells.columns + px) * 12
      const glyph = bytes.readUInt32LE(cell), upper = py % 2 === 0
      const foreground = glyph === 0x2588 || glyph === 0x2580 && upper || glyph === 0x2584 && !upper
      const encoded = bytes.readUInt32LE(cell + (foreground ? 4 : 8))
      const rgb = encoded === 0x01000000 ? foreground ? theme === 'dark' ? 0xE6E6E6 : 0x111111 : theme === 'dark' ? 0x0B0B0B : 0xFAFAFA : encoded
      const at = (y * width + x) * 4
      rgba[at] = rgb >> 16 & 255; rgba[at + 1] = rgb >> 8 & 255; rgba[at + 2] = rgb & 255; rgba[at + 3] = 255
    }
    const suffix = style === 'arcade' ? `-${theme}` : ''
    const contactKey = `t${columns}${suffix}`, items = terminals.get(contactKey) ?? []
    items.push({ name, rgba }); terminals.set(contactKey, items)
    writeFileSync(join(outdir, `${name}-t${columns}${suffix}.png`), pngRGBA(rgba, width, height))
    hudProof(name, columns, theme, rgba, cells.rows * 2)
    writeFileSync(join(outdir, `${name}-t${columns}${suffix}.txt`), terminal)
    writeFileSync(join(outdir, `${name}-hud${columns}.json`), JSON.stringify(scene.hud?.(d, columns), null, 2))
  }
  const svg = toSvg(frames, { fps: FPS.full, hotspots: scene.hotspots?.(d) })
  writeFileSync(join(outdir, `${name}.svg`), svg)
  contacts.push({ name, rgba: toRGBA(frames[0]!, 6) }); originals.push({ name, rgba: toRGBA(frames[0]!) })
  const hud = scene.hud?.(d, 100), escape = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
  const lines = (rows: HudLine[] = []) => rows.map(row => `<div>${row.map(s => `<span style="${s.color ? `color:${s.color};` : ''}${s.bold ? 'font-weight:bold;' : ''}${s.dim ? 'opacity:.65;' : ''}">${escape(s.text)}</span>`).join('')}</div>`).join('')
  cards.push(`<section><h2>${name}</h2><div class="hud">${lines(hud?.top)}</div>${svg}<div class="hud">${lines(hud?.bottom)}</div></section>`)
  process.stdout.write(`${name}: ${frames.length} frames, ${svg.length} svg chars, ${svg.length <= SVG_MAX ? 'OK' : 'OVER'}\n`)
}

// Labelled contact sheets include every fixture at each actual terminal crop.
function contact(filename: string, items: typeof contacts, width: number, height: number) {
  const tileW = width + 24, tileH = height + 42, sheetW = tileW * 2, sheetH = tileH * Math.ceil(items.length / 2)
  const sheet = new Uint8Array(sheetW * sheetH * 4)
  for (let at = 0; at < sheet.length; at += 4) { sheet[at] = 24; sheet[at + 1] = 24; sheet[at + 2] = 27; sheet[at + 3] = 255 }
  items.forEach(({ name, rgba }, n) => {
    const left = n % 2 * tileW + 12, top = Math.floor(n / 2) * tileH + 30
    for (let y = 0; y < height; y++) sheet.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), ((top + y) * sheetW + left) * 4)
    const label = canvas(100, 8, C.PAPER)
    name.toUpperCase().split('').forEach((ch, i) => sprite(label, { rows: FONT[ch]!, map: { '#': C.INK } }, i * 4, 1))
    const labelScale = width < 300 ? 1 : 3, labelWidth = label.w * labelScale, labelPixels = toRGBA(label, labelScale)
    for (let y = 0; y < label.h * labelScale; y++) sheet.set(labelPixels.subarray(y * labelWidth * 4, (y + 1) * labelWidth * 4), ((top - 27 + y) * sheetW + left) * 4)
  })
  writeFileSync(join(outdir, filename), pngRGBA(sheet, sheetW, sheetH))
}
if (style === 'arcade') contact('bunkers.png', [0, 50, 90].map(ctx => ({
  name: `${ctx} CONTEXT`, rgba: toRGBA(scene.frames({ ...FIXTURES.busy, ctx, edit: null }, { motion: 'still' })[0]!, 6),
})), 128 * 6, 72 * 6)
// Isolated silhouettes make it possible to review recognition without the furniture.
const atlas = canvas(260, 34, style === 'office' ? ROOM.wall : C.PAPER)
DESKS.forEach((p, i) => {
  const rows = style === 'office' ? MASCOTS[p] : SHIPS[p]
  sprite(atlas, { rows, map: style === 'office' ? { '#': ROOM.outline, a: OFFICE_CAST[p], l: ROOM.light, O: OFFICE_CAST.claude, k: OFFICE_ACCENTS.eye } : { '#': CAST[p] } }, i * 52 + Math.floor((52 - rows[0]!.length) / 2), 3)
  if (style === 'office' && p === 'opencode') {
    const left = i * 52 + Math.floor((52 - rows[0]!.length) / 2)
    for (const x of [left, left + 12]) for (let y = 9; y < 13; y++) { atlas.px[y * atlas.w + x] = ROOM.light; atlas.px[y * atlas.w + x + 1] = ROOM.light }
  }
  const label = p === 'claude' ? 'Clawd' : PROVIDER_NAMES[p]
  for (let ch = 0; ch < label.length; ch++) sprite(atlas, { rows: FONT[label[ch]!.toUpperCase()]!, map: { '#': style === 'office' ? ROOM.light : C.INK } }, i * 52 + Math.floor((52 - label.length * 4) / 2) + ch * 4, 27)
})
writeFileSync(join(outdir, 'cast.png'), png(atlas))
if (style === 'arcade') writeFileSync(join(outdir, 'cast-light.png'), png(atlas, 'light'))
contact('contact.png', contacts, sceneW * 6, sceneH * 6)
if (lightContacts.length) contact('contact-light.png', lightContacts, sceneW * 6, sceneH * 6)
contact('contact-1x.png', originals, sceneW, sceneH)
for (const [key, items] of terminals) {
  const width = Number(key.match(/^t(\d+)/)![1]) * 6
  contact(`contact-${key}.png`, items, width, items[0]!.rgba.length / (width * 4))
}
writeFileSync(join(outdir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${scene.name} preview</title><style>:root{color-scheme:dark light}body{background:light-dark(#FAFAFA,#18181B);color:light-dark(#111,#E6E6E6);font:13px/1.6 monospace;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,780px),1fr));gap:28px}h2{text-transform:uppercase;font-size:12px;opacity:.55}section{overflow:hidden}svg{display:block;width:100%;height:auto;image-rendering:pixelated;margin:12px 0}.hud{white-space:pre;overflow:hidden}</style><main>${cards.join('')}</main>`)
