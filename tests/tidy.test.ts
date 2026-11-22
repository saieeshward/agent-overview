import { expect, test } from 'claude-code/testing'
import { shapeFailure, shapeOf, tidy } from '../hooks/escalate'

// Real qwen2.5-coder:3b answers from evals/results-2026-11-22.json and the coding bake-off.

test('a prompt\'s own words give the shape: only code or JSON, one line, a character limit, a bullet count', () => {
  expect(shapeOf('Write one Python regular expression that fully matches an ISO date. Output only the pattern, nothing else.')).toEqual({ only: 'code', regex: true })
  expect(shapeOf('Write a one-line git commit message (max 72 characters, imperative mood) for this diff.')).toEqual({ oneLine: true, maxChars: 72 })
  expect(shapeOf('Explain what this Python function does, in exactly 3 short bullet points.')).toEqual({ bullets: 3 })
  expect(shapeOf('From this brief, return JSON only, with exactly these keys: brand, task.')).toEqual({ only: 'json' })
  expect(shapeOf('Summarise this Slack thread for the team.')).toEqual({})
})

test('a correct pattern wrapped in an explanation comes back as the pattern alone', () => {
  const answer = "To create a Python regular expression that matches an ISO calendar date in the format `YYYY-MM-DD`, you can use the following pattern:\n\n```regex\n^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$\n```\n\nHere's a breakdown of the"
  const shape = shapeOf('Write one Python regular expression ... Output only the pattern, nothing else.')
  const t = tidy(answer, shape)
  expect(t).toBe('^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$')
  expect(shapeFailure(t, shape)).toBeUndefined()
  // Without a fence: an intro line and a trailing explanation are dropped, the code kept.
  expect(tidy("Here's the function:\ndef add(a, b):\n    return a + b\n\nThis adds two numbers.", { only: 'code' })).toBe('def add(a, b):\n    return a + b')
})

test('a fourth bullet is trimmed when three were asked for; too few is escalated', () => {
  const answer = '- This function takes two lists of dictionaries as input.\n- It shuffles the lists and selects the top three cards.\n- The selected cards are paired into "Set A" and "Set B".\n- The function return'
  const shape = shapeOf('Explain what this Python function does, in exactly 3 short bullet points for a teammate.')
  const t = tidy(answer, shape)
  expect(t.split('\n')).toHaveLength(3)
  expect(t).not.toContain('The function return')
  expect(shapeFailure(t, shape)).toBeUndefined()
  expect(shapeFailure('- only one', shape)).toBe('it gave 1 bullet point, not the 3 asked for')
})

test('a one-line answer keeps its first line; one over the character limit is escalated, not cut', () => {
  const shape = shapeOf('Write a one-line git commit message (max 72 characters, imperative mood) for this diff.')
  expect(tidy('Commit message: "Slow LinkedIn requests and cap results at 200"\n\nThis change...', shape)).toBe('Slow LinkedIn requests and cap results at 200')
  const long = tidy('Increase random sleep duration and reduce results limit to avoid LinkedIn rate limits.', shape)
  expect(shapeFailure(long, shape)).toBe('its answer is 86 characters, over the 72 asked for')
})

test('JSON is lifted out of chatter; an answer with no valid JSON is escalated; prose without a shape is untouched', () => {
  const shape = shapeOf('Return JSON only with keys a and b.')
  const t = tidy('Sure! Here is the JSON:\n{"a": 1, "b": [2, 3]}\nLet me know if you need more.', shape)
  expect(JSON.parse(t)).toEqual({ a: 1, b: [2, 3] })
  expect(shapeFailure(tidy('I could not find those fields.', shape), shape)).toContain('not valid JSON')
  const prose = 'The thread agrees to ship on Friday.\n\nAnna owns the release notes.'
  expect(tidy(prose, shapeOf('Summarise this Slack thread.'))).toBe(prose)
})

test('a regex answer loses its r"..." wrapper and must compile; the live 2026-11-22 UK-postcode answer is escalated', () => {
  const shape = shapeOf('Write one Python regular expression that fully matches a UK postcode. Output only the pattern, nothing else.')
  expect(shape.regex).toBe(true)
  const broken = tidy('r"^(GIR 0AA|[A-PR-UWYZ]([0-9]{1,2}|[A-Z][0-9]?)[0-9][ABD-HJLNP-UW-Z]{2}|(GB-[0-9]{4})$"', shape)
  expect(broken.startsWith('^(GIR')).toBe(true)
  expect(shapeFailure(broken, shape)).toBe('its regex does not compile')
  const good = tidy("r'^[A-Z]{1,2}\\d[A-Z\\d]? \\d[A-Z]{2}$'", shape)
  expect(good).toBe('^[A-Z]{1,2}\\d[A-Z\\d]? \\d[A-Z]{2}$')
  expect(shapeFailure(good, shape)).toBeUndefined()
  expect(shapeFailure('(?P<year>\\d{4})-(?P=year)', shape)).toBeUndefined()
})
