import { expect, test } from 'claude-code/testing'

import { editWindow, partialField, trimEdits } from '../hooks/stream'

test('reads a string field from JSON that is still arriving', async () => {
  expect(partialField('{"file_path":"a', 'new_string')).toBeUndefined()
  expect(partialField('{"file_path":"a.ts","new_string":"', 'new_string')).toBe('')
  expect(partialField('{"file_path":"a.ts","new_string":"foo\\nba', 'new_string')).toBe('foo\nba')
  expect(partialField('{"new_string":"say \\"hi\\" ok"}', 'new_string')).toBe('say "hi" ok')
  expect(partialField('{"new_string":"cut \\', 'new_string')).toBe('cut ')
  expect(partialField('{"new_string":"e\\u00e', 'new_string')).toBe('e')
  expect(partialField('{"new_string":"e\\u00e9!', 'new_string')).toBe('eé!')
  expect(partialField('{"file_path":"/x/y.ts","content":"a', 'file_path')).toBe('/x/y.ts')
  expect(partialField('{"old_string":"\\"new_string\\":\\"no","new_string":"yes', 'new_string')).toBe('yes')
})

test('edit trimming drops the oldest settled entries and keeps every pending review', async () => {
  const items = Array.from({ length: 45 }, (_, id) => ({ id, review: id === 0 || id === 3 ? 'pending' : id % 2 ? 'kept' : undefined }))
  const kept = trimEdits(items)
  expect(kept.length).toBe(40)
  expect(kept.map(x => x.id)).toEqual([0, 3, ...Array.from({ length: 38 }, (_, i) => i + 7)])
  const pending = Array.from({ length: 45 }, (_, id) => ({ id, review: 'pending' }))
  expect(trimEdits([...pending, { id: 45, review: 'kept' }])).toEqual(pending)
  expect(trimEdits(items.slice(0, 3))).toEqual(items.slice(0, 3))
})


test('edit windows locate the first match and keep bounded file context', async () => {
  const file = 'one\ntwo\nthree\nfour\nfive\nsix\nthree\nfour\nnine'
  expect(editWindow(file, 'three\nfour', 2)).toEqual({ startLine: 3, before: ['one', 'two'], old: ['three', 'four'], after: ['five', 'six'] })
  expect(editWindow(file, 'one', 2)).toEqual({ startLine: 1, before: [], old: ['one'], after: ['two', 'three'] })
  expect(editWindow(file, 'nine', 2)).toEqual({ startLine: 9, before: ['three', 'four'], old: ['nine'], after: [] })
  expect(editWindow(file, 'missing')).toBeUndefined()
  expect(editWindow(file, 'three', 0)).toEqual({ startLine: 3, before: [], old: ['three'], after: [] })
  expect(editWindow('a\r\nb\r\nc', 'b\r\n')).toEqual({ startLine: 2, before: ['a'], old: ['b'], after: ['c'] })
  expect(editWindow('a\nb', '')).toEqual({ startLine: 1, before: [], old: [], after: ['a', 'b'] })
  expect(editWindow(file, 'two')).toEqual({ startLine: 2, before: ['one'], old: ['two'], after: ['three', 'four', 'five', 'six', 'three', 'four'] })
})
