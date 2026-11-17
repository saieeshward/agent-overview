import { expect, test } from 'claude-code/testing'
import { C, CAST, FONT, FPS, H, PALETTE, TERMINAL_DEFAULT, SVG_MAX, W, canvas, clone, dither, fitColumns, line, pixel, rect, sprite, text, textWidth, toCells, toRGBA, toSvg } from '../hooks/vibe/engine'
import { FIXTURES } from '../hooks/vibe/fixtures'
import { OFFICE_W, OFFICE_H } from '../hooks/vibe/office'
import { SCENES } from '../hooks/vibe/scenes'

const cellsOf = (encoded: string) => {
  const bytes = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0))
  return new DataView(bytes.buffer)
}

test('canvas primitives floor coordinates, clip at edges and clone independently', () => {
  const c = canvas(4, 3)
  pixel(c, -0.1, 0, C.red)
  pixel(c, 4, 1, C.red)
  pixel(c, 1.9, 0.9, C.blue)
  expect([...c.px]).toEqual([0, C.blue, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  rect(c, -1, 1, 3, 5, C.green)
  rect(c, 8, 0, 2, 2, C.red)
  rect(c, 0, 0, -1, 2, C.red)
  expect([...c.px]).toEqual([0, C.blue, 0, 0, C.green, C.green, 0, 0, C.green, C.green, 0, 0])
  const copied = clone(c)
  pixel(copied, 0, 0, C.white)
  expect(c.px[0]).toBe(C.black)
  expect(copied.px[0]).toBe(C.white)
  expect(canvas().px.length).toBe(W * H)
  line(c, -1, -1, 3.9, 3.9, C.yellow)
  expect(c.px[0]).toBe(C.yellow)
  expect(c.px[5]).toBe(C.yellow)
  expect(c.px[10]).toBe(C.yellow)
  line(c, 3, 2, 0, 2, C.orange)
  expect([...c.px.slice(8)]).toEqual([C.orange, C.orange, C.orange, C.orange])
})

test('sprites mirror and respect transparency, dithering covers both extremes and half a tile', () => {
  const c = canvas(4, 2, C.navy), s = { rows: ['ab .', '.a'], map: { a: C.red, b: C.blue, '.': C.white, ' ': C.white } }
  sprite(c, s, 0, 0)
  expect([...c.px]).toEqual([C.red, C.blue, C.navy, C.navy, C.navy, C.red, C.navy, C.navy])
  const flipped = canvas(4, 2, C.navy)
  sprite(flipped, s, 0, 0, true)
  expect([...flipped.px]).toEqual([C.navy, C.navy, C.blue, C.red, C.navy, C.navy, C.red, C.navy])
  const tile = canvas(4, 4)
  dither(tile, -1, -1, 6, 6, C.red, C.blue, 0)
  expect([...tile.px].every(i => i === C.red)).toBe(true)
  dither(tile, 0, 0, 4, 4, C.red, C.blue, 1)
  expect([...tile.px].every(i => i === C.blue)).toBe(true)
  dither(tile, 0, 0, 4, 4, C.red, C.blue)
  expect([...tile.px].filter(i => i === C.blue).length).toBe(8)
})

test('the pixel font covers its contract, uppercases and substitutes unknown characters', () => {
  for (const ch of `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?-+/()'"%$#*=<>_ `) {
    const glyph = FONT[ch]
    expect(glyph).toHaveLength(5)
    expect(glyph!.every(row => /^[#.]{3}$/.test(row))).toBe(true)
  }
  const c = canvas(3, 5)
  expect(text(c, 'a', 0, 0, C.white)).toBe(textWidth('a'))
  expect([...c.px]).toEqual(FONT.A!.join('').split('').map(ch => ch === '#' ? C.white : C.black))
  const question = canvas(3, 5), unknown = canvas(3, 5)
  text(question, '?', 0, 0, C.red); text(unknown, 'ß', 0, 0, C.red)
  expect([...unknown.px]).toEqual([...question.px])
  expect(textWidth('')).toBe(0)
  expect(textWidth('HELLO')).toBe(19)
})

test('Raster cells encode little-endian half blocks and terminal default under an odd last row', () => {
  const c = canvas(2, 3)
  c.px.set([C.claude, C.codex, C.antigravity, C.opencode, C.commandcode, C.white])
  const raster = toCells(c), view = cellsOf(raster.cells)
  expect(raster.columns).toBe(2)
  expect(raster.rows).toBe(2)
  expect(view.byteLength).toBe(raster.columns * raster.rows * 12)
  for (let n = 0; n < raster.columns * raster.rows; n++) expect(view.getUint32(n * 12, true)).toBe(0x2580)
  expect(view.getUint32(4, true)).toBe(PALETTE[C.claude])
  expect(view.getUint32(8, true)).toBe(PALETTE[C.antigravity])
  expect(view.getUint32(28, true)).toBe(PALETTE[C.commandcode])
  expect(view.getUint32(32, true)).toBe(0x01000000)
  expect(raster.cells.length % 4).toBe(0)
  const scaled = toCells(c, 4), up = cellsOf(scaled.cells)
  expect(scaled.rows).toBe(3)
  expect(up.byteLength).toBe(4 * 3 * 12)
  expect(up.getUint32(4, true)).toBe(up.getUint32(16, true))
  expect(up.getUint32(4, true)).toBe(PALETTE[C.claude])
  expect(toCells(canvas(1, 1), 0).columns).toBe(1)
  const tall = toCells(canvas(1, 600), 600)
  expect(tall.columns).toBe(1)
  expect(tall.rows).toBe(256)
})

test('RGBA exports nearest-neighbor pixels and opaque alpha at integer scale', () => {
  const c = canvas(2, 1, C.claude)
  pixel(c, 1, 0, C.codex)
  const rgba = toRGBA(c, 2)
  expect(rgba.length).toBe(2 * 2 * 1 * 2 * 4)
  expect([...rgba.slice(0, 8)]).toEqual([0xD9, 0x77, 0x57, 255, 0xD9, 0x77, 0x57, 255])
  expect([...rgba.slice(8, 12)]).toEqual([0x10, 0xA3, 0x7F, 255])
  expect([...rgba.slice(16, 20)]).toEqual([...rgba.slice(0, 4)])
  expect(Object.entries(C)).toHaveLength(46)
  expect(CAST).toEqual({ claude: C.claude, codex: C.codex, antigravity: C.antigravity, opencode: C.opencode, commandcode: C.commandcode })
})

test('SVG merges runs vertically, overlays frame deltas, animates slots and escapes titles', () => {
  const c = canvas(3, 2, C.red), next = clone(c)
  pixel(next, 1, 0, C.blue)
  const svg = toSvg([c, next, c], { fps: 12, hotspots: [{ x: 0, y: 0, w: 3, h: 2, title: `<agent & "model">'` }] })
  expect(svg).toContain('viewBox="0 0 3 2" width="18" height="12" shape-rendering="crispEdges"')
  expect(svg).toContain('d="M0 0h3v2h-3z"')
  expect(svg).toContain('d="M1 0h1v1h-1z"')
  expect(svg.match(/<animate /g)).toHaveLength(2)
  expect(svg).toContain('values="hidden;visible;hidden;hidden"')
  expect(svg).toContain('dur="0.25s"')
  expect(svg).toContain('&lt;agent &amp; &quot;model&quot;&gt;&apos;')
  expect(toSvg([c], { fps: 12 })).not.toContain('<animate')
  expect(toSvg([c, next], { fps: 0 })).not.toContain('<animate')
  expect(() => toSvg([], { fps: 12 })).toThrow()
  expect(() => toSvg([c, canvas(4, 2)], { fps: 12 })).toThrow()
  expect(() => toSvg([c], { fps: 12, max: 10 })).toThrow()
})

test('SVG frame reduction obeys the size budget and preserves loop duration', () => {
  const frames = Array.from({ length: 8 }, (_, f) => {
    const c = canvas(16, 8)
    for (let i = 0; i < c.px.length; i++) c.px[i] = (i * 7 + f * 5) % PALETTE.length
    return c
  })
  const full = toSvg(frames, { fps: 12 })
  const max = toSvg([frames[0]!, frames[4]!], { fps: 12 }).length + 100
  const reduced = toSvg(frames, { fps: 12, max })
  expect(full.length).toBeGreaterThan(max)
  expect(reduced.length).toBeLessThanOrEqual(max)
  expect((reduced.match(/<animate /g) ?? []).length).toBeLessThan(7)
  expect(reduced).toContain(`dur="${8 / 12}s"`)
  const staticMax = toSvg([frames[0]!], { fps: 12 }).length
  expect(toSvg(frames, { fps: 12, max: staticMax })).not.toContain('<animate')
})

for (const scene of Object.values(SCENES)) for (const [name, d] of Object.entries(FIXTURES)) for (const motion of ['full', 'calm', 'still'] as const) {
  test(`${scene.id} ${name} ${motion} fits the desktop SVG limit`, () => {
    const frames = scene.frames(d, { motion })
    if (motion === 'still') expect(frames.length).toBe(1)
    else expect(frames.length).toBeGreaterThanOrEqual(2)
    const [w, h] = scene.id === 'office' ? [OFFICE_W, OFFICE_H] : [W, 82]
    expect(frames.every(c => c.w === w && c.h === h && c.px.length === w! * h!)).toBe(true)
    const svg = toSvg(frames, { fps: FPS[motion] || 1, hotspots: scene.hotspots?.(d) })
    expect(svg.length).toBeLessThanOrEqual(SVG_MAX)
    if (motion === 'still') expect(svg).not.toContain('<animate')
    else expect((svg.match(/<animate /g) ?? []).length).toBeLessThanOrEqual(frames.length - 1)
    if (scene.id === 'office') expect(scene.hotspots?.(d).length).toBeGreaterThanOrEqual(d.agents.length)
  })
}

test('fitColumns chooses integer canvas multiples once they fit', () => {
  expect(fitColumns(64)).toBe(64)
  expect(fitColumns(128)).toBe(128)
  expect(fitColumns(300)).toBe(256)
  expect(fitColumns(70, 32)).toBe(64)
})


test('SVG size passes compute every frame path only once', () => {
  let reads = 0
  const frames = Array.from({ length: 8 }, (_, i) => {
    const c = canvas(16, 16, i % 2 ? C.codex : C.claude)
    return { w: c.w, h: c.h, get px() { reads++; return c.px } }
  })
  const staticSize = toSvg([frames[0]!], { fps: 0 }).length
  reads = 0
  toSvg(frames, { fps: 12, max: 1000000 })
  const once = reads
  reads = 0
  const small = toSvg(frames, { fps: 12, max: staticSize })
  expect(small.length).toBeLessThanOrEqual(staticSize)
  expect(reads).toBe(once)
})

for (const style of ['office', 'arcade'] as const) for (const columns of [64, 100, 128]) test(`${style} at ${columns} columns crops its focus at 1:1, including short panes`, () => {
  const scene = SCENES[style], d = FIXTURES.busy, c = scene.frames(d, { motion: 'still' })[0]!, focus = scene.focus!(d)
  for (const maxRows of [12, 36]) {
    const out = toCells(c, columns, focus, maxRows), view = cellsOf(out.cells)
    const x0 = Math.max(0, Math.min(c.w - columns, Math.floor(focus.x + focus.w / 2 - columns / 2)))
    const height = out.rows * 2, y0 = Math.max(0, Math.min(c.h - height, Math.floor(focus.y + focus.h / 2 - height / 2)))
    expect(out.columns).toBe(columns); expect(out.rows).toBeLessThanOrEqual(maxRows)
    for (let y = 0; y < height; y++) for (let x = 0; x < columns; x++) {
      const cell = (Math.floor(y / 2) * columns + x) * 12
      const expected = c.px[(y0 + y) * c.w + x0 + x]!
      const glyph = view.getUint32(cell, true), foreground = glyph === 0x2588 || glyph === 0x2580 && y % 2 === 0 || glyph === 0x2584 && y % 2 === 1
      const encoded = view.getUint32(cell + (foreground ? 4 : 8), true)
      if (expected === C.INK || expected === C.PAPER) {
        expect(encoded).toBe(TERMINAL_DEFAULT); expect(foreground).toBe(expected === C.INK)
      } else expect(encoded).toBe(PALETTE[expected])
    }
  }
})


test('theme-aware cells encode all four half-block cases with default foreground and background', () => {
  const c = canvas(4, 2, C.PAPER)
  c.px.set([C.INK, C.PAPER, C.INK, C.PAPER, C.INK, C.INK, C.PAPER, C.PAPER])
  const view = cellsOf(toCells(c).cells)
  expect([0, 1, 2, 3].map(i => view.getUint32(i * 12, true))).toEqual([0x2588, 0x2584, 0x2580, 0x20])
  for (let i = 0; i < 4; i++) {
    expect(view.getUint32(i * 12 + 4, true)).toBe(TERMINAL_DEFAULT)
    expect(view.getUint32(i * 12 + 8, true)).toBe(TERMINAL_DEFAULT)
  }
  expect([...toRGBA(c, 1, 'light').slice(0, 8)]).toEqual([17, 17, 17, 255, 250, 250, 250, 255])
})

test('mixed tint and theme cells retain default ink and paper on either half', () => {
  const c = canvas(4, 2, C.PAPER)
  c.px.set([C.codex, C.PAPER, C.INK, C.codex, C.PAPER, C.codex, C.codex, C.INK])
  const view = cellsOf(toCells(c).cells)
  expect([0, 1, 2, 3].map(i => view.getUint32(i * 12, true))).toEqual([0x2580, 0x2584, 0x2580, 0x2584])
  for (const x of [0, 1]) { expect(view.getUint32(x * 12 + 4, true)).toBe(PALETTE[C.codex]); expect(view.getUint32(x * 12 + 8, true)).toBe(TERMINAL_DEFAULT) }
  for (const x of [2, 3]) { expect(view.getUint32(x * 12 + 4, true)).toBe(TERMINAL_DEFAULT); expect(view.getUint32(x * 12 + 8, true)).toBe(PALETTE[C.codex]) }
})
