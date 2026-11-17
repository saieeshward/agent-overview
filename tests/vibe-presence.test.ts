import { expect, test } from 'claude-code/testing'
import { DESKS, office, officeActor, officeStatus } from '../hooks/vibe/office'
import { arcade, arcadePlan } from '../hooks/vibe/arcade'
import { canvas, SVG_MAX, toCells } from '../hooks/vibe/engine'
import { FIXTURES } from '../hooks/vibe/fixtures'
import { sceneKey } from '../hooks/vibe/data'

for (const name of ['all-idle', 'mixed-working-idle'] as const) test(`${name} keeps every enabled provider present after old work expires`, () => {
  const d = FIXTURES[name]
  for (const motion of ['full', 'calm', 'still'] as const) {
    for (const p of DESKS) {
      const c = canvas(160, 80, 255)
      officeActor(c, d, p, 0)
      expect(c.px.some(i => i !== 255)).toBe(true)
      if (motion !== 'still' && !officeStatus(d, p).typing) {
        const later = canvas(160, 80, 255)
        officeActor(later, d, p, 6)
        expect([...later.px]).not.toEqual([...c.px])
      }
    }
    for (const width of [64, 100, 140]) {
      const fleet = arcadePlan(d, width), focus = arcade.focus!(d, { width })
      expect(fleet.ships.map(s => s.provider)).toEqual(DESKS)
      for (const s of fleet.ships) {
        expect(s.x).toBeGreaterThanOrEqual(focus.x)
        expect(s.x + s.w).toBeLessThanOrEqual(focus.x + focus.w)
      }
      for (const scene of [office, arcade]) for (const frame of scene.frames(d, { motion, width, maxRows: 30 })) {
        const raster = toCells(frame, width, scene.focus!(d, { width }), 30)
        expect(raster.columns).toBe(Math.min(width, frame.w))
        expect(raster.rows).toBeLessThanOrEqual(30)
      }
    }
  }
})

test('off providers leave, Saver and exhausted providers stay parked, and Claude stays present', () => {
  const base = FIXTURES['all-idle']
  for (const provider of DESKS) {
    const d = { ...base, usage: base.usage.map(u => u.provider === provider ? { ...u, on: false } : u), events: [{ kind: 'provider-off' as const, provider, at: base.now - 6000 }] }
    expect(arcadePlan(d).ships.some(s => s.provider === provider)).toBe(provider === 'claude')
    const c = canvas(160, 80, 255)
    officeActor(c, d, provider, 0)
    expect(c.px.some(i => i !== 255)).toBe(provider === 'claude')
  }
  const parked = { ...FIXTURES.busy, usage: base.usage.map(u => ({ ...u, out: true, tag: 'saver' as const })) }
  expect(arcadePlan(parked).ships).toHaveLength(5)
  expect(arcadePlan(parked).ships.every(s => s.parked && !s.working)).toBe(true)
})

test('failed providers keep their look briefly and settle to idle without disappearing or stale scene caches', () => {
  const base = FIXTURES['all-idle']
  const d = { ...base, agents: [{ ...FIXTURES.busy.agents[0]!, state: 'failed' as const, endedAt: base.now }] }
  const settled = { ...d, now: d.now + 30000 }
  expect(officeStatus(d, 'codex').failed).toBe(true)
  expect(officeStatus(settled, 'codex').failed).toBe(false)
  expect(arcadePlan(settled).ships.find(s => s.provider === 'codex')?.failed).toBe(false)
  for (const scene of [office, arcade]) expect(sceneKey(d, scene)).not.toBe(sceneKey(settled, scene))
  const saver = { ...base, usage: base.usage.map(u => u.provider === 'codex' ? { ...u, tag: 'saver' as const } : u) }
  expect(sceneKey(base, office)).not.toBe(sceneKey(saver, office))
})


test('every docked ship blinks without moving its silhouette or hiding another provider', () => {
  const d = FIXTURES['all-idle'], frames = arcade.frames(d, { motion: 'full' })
  for (const ship of arcadePlan(d).ships) {
    const region = (index: number) => Array.from({ length: ship.h }, (_, y) => [...frames[index]!.px.slice((ship.y + y) * 128 + ship.x, (ship.y + y) * 128 + ship.x + ship.w)]).flat()
    expect(region(0)).not.toEqual(region(6))
  }
  const old = { ...FIXTURES.busy.agents[0]!, state: 'done' as const, endedAt: d.now - 10000 }
  const failed = { ...old, id: 'failed', state: 'failed' as const, endedAt: d.now }
  expect(officeStatus({ ...d, agents: [old, failed] }, 'codex').failed).toBe(true)
  expect(officeStatus({ ...d, agents: [failed, { ...old, id: 'retry', endedAt: d.now + 1 }], now: d.now + 1 }, 'codex').failed).toBe(false)
})
