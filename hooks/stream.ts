// Reads one string field out of tool-call JSON that is still arriving,
// e.g. partialField('{"file_path":"a.ts","new_string":"foo\\nba', 'new_string') === 'foo\nba'.
// Returns undefined until the field's opening quote has arrived.
export const partialField = (json: string, key: string): string | undefined => {
  const at = json.search(new RegExp(`"${key}"\\s*:\\s*"`))
  if (at < 0) return undefined
  let i = json.indexOf('"', json.indexOf(':', at + key.length + 2)) + 1
  let raw = ''
  for (; i < json.length; i++) {
    const c = json[i]
    if (c === '"') break
    if (c === '\\') {
      // An escape cut off mid-way waits for the next piece.
      const esc = json[i + 1]
      if (esc === undefined) break
      if (esc === 'u') {
        if (i + 6 > json.length) break
        raw += json.slice(i, i + 6)
        i += 5
        continue
      }
      raw += c + esc
      i++
      continue
    }
    raw += c
  }
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return undefined
  }
}

// The tools whose arguments carry code worth watching, and the field holding it.
export const STREAMED: Record<string, string> = { Edit: 'new_string', Write: 'content', NotebookEdit: 'new_source' }

// The changed stretch of a file with a little context: equal head and tail lines are dropped,
// so a two-line change in a long file shows as two lines, not the whole file.
export const hunk = (before: string[], after: string[], context = 2) => {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  const from = Math.max(0, head - context)
  return {
    before: before.slice(from, Math.min(before.length, before.length - tail + context)),
    after: after.slice(from, Math.min(after.length, after.length - tail + context)),
    removed: before.length - head - tail,
    added: after.length - head - tail,
  }
}

// NUL framing keeps tabs and newlines in paths intact, including Git's two-path rename form.
export function numstat(text: string) {
  const parts = text.split('\0')
  const files: { path: string; added: number; removed: number; isNew: boolean }[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(parts[i]!)
    if (!m) continue
    let path = m[3]!
    if (!path) {
      if (i + 3 >= parts.length) break
      i++ // The old path is followed by the current path.
      path = parts[++i]!
    }
    if (path) files.push({ path, added: Number(m[1]) || 0, removed: Number(m[2]) || 0, isNew: false })
  }
  return files
}

export function sideWindow(before: string[], after: string[], context = 3) {
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  const changed = hunk(before, after, 0)
  return {
    startLine: head + 1,
    before: after.slice(Math.max(0, head - context), head),
    old: changed.before,
    text: changed.after.join('\n'),
    after: after.slice(head + changed.added, head + changed.added + context),
  }
}

// Pending reviews stay until the owner settles them, even when they alone exceed the limit.
export const trimEdits = <T extends { review?: string }>(items: T[], limit = 40): T[] => {
  let drop = Math.max(0, items.length - limit)
  return items.filter(x => x.review === 'pending' || drop-- <= 0)
}

// Locate the first replacement before the tool changes the file.
export const editWindow = (fileText: string, oldString: string, ctx = 6) => {
  const at = fileText.indexOf(oldString)
  if (at < 0) return undefined
  const lines = fileText.split(/\r?\n/)
  const first = fileText.slice(0, at).split('\n').length - 1
  const old = oldString ? oldString.replace(/\r?\n$/, '').split(/\r?\n/) : []
  const end = first + old.length
  return { startLine: first + 1, before: lines.slice(Math.max(0, first - ctx), first), old, after: lines.slice(end, end + ctx) }
}
