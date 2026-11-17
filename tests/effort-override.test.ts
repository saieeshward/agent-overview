import { expect, test } from 'claude-code/testing'
import { isProblem, lowerEffort, parseDeclaration } from '../hooks/policy'

test('a declaration may name an effort after the sensitivity', () => {
  const d = parseDeclaration('task:review sensitivity:internal effort:medium Round 2')
  expect(isProblem(d)).toBe(false)
  if (!isProblem(d)) { expect(d.effort).toBe('medium'); expect(d.rest).toBe('Round 2') }
  const plain = parseDeclaration('task:review sensitivity:internal Round 2')
  if (!isProblem(plain)) expect(plain.effort).toBeUndefined()
})

test('an unknown effort is refused like any off-table declaration', () => {
  const d = parseDeclaration('task:review sensitivity:internal effort:huge x')
  expect(isProblem(d) && d.problem).toBe('off-table')
})

test('the override only lowers: the owner table is the ceiling', () => {
  expect(lowerEffort('high', 'medium')).toBe('medium')
  expect(lowerEffort('high', 'low')).toBe('low')
  expect(lowerEffort('medium', 'max')).toBe('medium')
  expect(lowerEffort('high', undefined)).toBe('high')
  expect(lowerEffort(undefined, 'low')).toBeUndefined()
})
