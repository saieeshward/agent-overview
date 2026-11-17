// Preview painters only: the test kit validates the tree; these approximate host paint.
export type Element = { type: string; props: Record<string, any>; children?: (Element | string)[] }
const palette: Record<string, string> = { claude: '#d97757', success: '#73c991', error: '#f48771', warning: '#e5c07b', suggestion: '#82aaff', planMode: '#c792ea', inactive: '#858585', subtle: '#a0a0a0', inverseText: '#ffffff', text: '#e6e6e6', codex: '#10a37f', opencode: '#a78bfa', commandcode: '#f59e0b', antigravity: '#4285f4', background: '#1e1e1e' }
export const color = (s?: string) => s ? palette[s] ?? s : '#e6e6e6'
const escape = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const text = (n: Element | string): string => typeof n === 'string' ? n : n.type === 'Code' ? n.props?.source : (n.children ?? []).map(text).join('') || n.props?.label || ''
const selectedLabel = (p: Record<string, any>) => {
  const option = p.options?.find((o: any) => o.value === p.value)
  return option?.label ?? option?.value ?? p.value ?? p.options?.[0]?.label ?? p.options?.[0]?.value ?? ''
}
const space = (v: any) => typeof v === 'number' ? v : ({ xs: .5, sm: 1, md: 2, lg: 3, xl: 4 } as any)[v] ?? 0
const dimension = (v: any, unit: number) => typeof v === 'number' ? `${v * unit}px` : v
const data = (n: Element) => `data-type="${n.type}" data-key="${escape(n.props?.key ?? '')}"`
export function desktop(n: Element | string): string {
  if (typeof n === 'string') return escape(n)
  const p = (n.props ?? {}), children = () => (n.children ?? []).map(desktop).join(''), styles: string[] = []
  if (p.color) styles.push(`color:${color(p.color)}`)
  if (p.backgroundColor) styles.push(`background:${color(p.backgroundColor)}`)
  if (p.dimColor) styles.push('opacity:.6')
  if (p.weight === 'bold' || p.bold) styles.push('font-weight:700')
  if (p.italic) styles.push('font-style:italic')
  if (p.inverse) styles.push(`background:${color(p.color)};color:#1e1e1e`)
  if (n.type === 'Box') {
    styles.push(`display:${p.display === 'none' ? 'none' : 'flex'}`, `flex-direction:${p.flexDirection ?? 'row'}`, 'min-width:0')
    for (const k of ['flexGrow', 'flexShrink', 'flexWrap', 'alignItems', 'alignSelf', 'justifyContent', 'overflow', 'position']) if (p[k] !== undefined) styles.push(`${k.replace(/[A-Z]/g, x => '-' + x.toLowerCase())}:${p[k]}`)
    if (p.position !== 'absolute') styles.push('position:relative')
    for (const k of ['width', 'height', 'minWidth', 'minHeight', 'top', 'right', 'bottom', 'left']) if (p[k] !== undefined) styles.push(`${k.replace(/[A-Z]/g, x => '-' + x.toLowerCase())}:${dimension(p[k], /[Hh]eight|top|bottom/.test(k) ? 20 : 8)}`)
    // Spacing is in cells: 8 px across, 20 px down, as the desktop draws it.
    if (p.gap !== undefined) styles.push(`row-gap:${space(p.gap) * 20}px`, `column-gap:${space(p.gap) * 8}px`)
    if (p.rowGap !== undefined) styles.push(`row-gap:${space(p.rowGap) * 20}px`)
    if (p.columnGap !== undefined) styles.push(`column-gap:${space(p.columnGap) * 8}px`)
    for (const kind of ['margin', 'padding']) {
      if (p[kind] !== undefined) styles.push(`${kind}:${space(p[kind]) * 20}px ${space(p[kind]) * 8}px`)
      for (const [axis, sides] of [['X', ['left', 'right']], ['Y', ['top', 'bottom']], ['Top', ['top']], ['Bottom', ['bottom']], ['Left', ['left']], ['Right', ['right']]] as const)
        if (p[kind + axis] !== undefined) for (const side of sides) styles.push(`${kind}-${side}:${space(p[kind + axis]) * (side === 'top' || side === 'bottom' ? 20 : 8)}px`)
    }
    if (p.borderStyle) styles.push(`border:${p.borderStyle === 'bold' ? 2 : 1}px solid ${color(p.borderColor)}`, 'border-radius:8px')
    return `<div ${data(n)} style="${styles.join(';')}">${children()}</div>`
  }
  if (n.type === 'Text') {
    if (p.size === 'title') styles.push('font-size:28px;line-height:36px')
    if (p.size === 'heading') styles.push('font-size:20px;line-height:28px')
    if (p.size === 'caption') styles.push('font-size:11px')
    if (p.wrap?.startsWith('truncate')) styles.push(`white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${p.wrap === 'truncate-start' ? 'direction:rtl' : ''}`)
    return `<span ${data(n)} style="${styles.join(';')}">${children()}</span>`
  }
  if (n.type === 'Link') return `<a ${data(n)} href="${escape(p.href)}" style="color:${color('suggestion')}">${children() || escape(p.label || p.href)}</a>`
  if (n.type === 'Button') return `<button ${data(n)} class="${p.variant === 'primary' ? 'primary' : ''}" style="${[...styles, ...(p.plain ? ['text-align:left'] : [])].join(';')}">${escape(text(n).trim())}</button>`
  if (n.type === 'Input') return `<div ${data(n)} class="input" style="${styles.join(';')}">${escape(p.value ?? p.placeholder ?? '')}${p.autoFocus ? ` <b>${escape(p.submitLabel ?? '↵')}</b>` : ''}</div>`
  if (n.type === 'Select') return `<div ${data(n)} class="select" style="${styles.join(';')}">${escape(p.label ? p.label + ' ' : '')}${escape(selectedLabel(p))} ▾</div>`
  if (n.type === 'Code' || n.type === 'Markdown') return `<pre ${data(n)}>${escape(p.source ?? p.text ?? text(n))}</pre>`
  if (n.type === 'Svg') {
    const width = p.width ?? Number(/\bwidth="([\d.]+)"/.exec(p.source)?.[1] ?? 300)
    const intrinsic = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(p.source)
    const height = p.height ?? (intrinsic ? width * Number(intrinsic[2]) / Number(intrinsic[1]) : Number(/\bheight="([\d.]+)"/.exec(p.source)?.[1] ?? 150))
    const style = `width:${width}px;max-width:100%;height:${height}px;border:0;display:block;flex-shrink:0`
    // The desktop's interactive sandbox drops embedded images, including data URLs.
    const interactive = p.source.replace(/<image\b[^>]*(?:\/>|>[\s\S]*?<\/image\s*>)/gi, '')
    return p.isInteractive ? `<iframe ${data(n)} title="${escape(p.alt)}" sandbox style="${style}" srcdoc="${escape(`<html style="color-scheme:dark"><head><style>html,body{margin:0;background:#1e1e1e;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style></head><body>${interactive}</body></html>`)}"></iframe>` : `<img ${data(n)} alt="${escape(p.alt)}" style="${style}" src="data:image/svg+xml;base64,${Buffer.from(p.source).toString('base64')}">`
  }
  throw new Error(`Unsupported desktop element: ${n.type}`)
}
export const desktopPage = (tree: Element) => `<!doctype html><html style="color-scheme:dark"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:12px;background:#1e1e1e;color:#e6e6e6;font:13px/20px Menlo,monospace}body>div{width:100%}span{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}button{font:13px/20px Menlo,monospace;color:#ddd;background:#2d2d2d;border:1px solid #484848;border-radius:16px;padding:4px 12px;max-width:100%;white-space:normal;overflow-wrap:anywhere;flex-shrink:0}button.primary{background:#d97757;border-color:#d97757;color:#fff;font-weight:700}.select,.input{padding:4px 8px;border:1px solid #555;border-radius:5px;background:#252526;overflow-wrap:anywhere;min-width:0;max-width:100%}.input{width:100%;min-height:30px;display:flex;justify-content:space-between;gap:8px}.input b{color:#aaa;font-weight:400}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit}</style>${desktop(tree)}</html>`

type Cell = { ch: string; fg: string; bg: string; bold?: boolean; dim?: boolean }
type Grid = Cell[][]
const cell = (ch = ' ', fg = '#e6e6e6', bg = '#1e1e1e'): Cell => ({ ch, fg, bg })
function runs(n: Element | string, inherited: Partial<Cell> = {}): Cell[] {
  if (typeof n === 'string') return Array.from(n).flatMap(ch => {
    const c = { ...cell(ch), ...inherited }
    const code = ch.codePointAt(0)!
    return code >= 0x1f300 && code <= 0x1faff || code >= 0x2e80 && code <= 0x9fff ? [c, { ...c, ch: '' }] : [c]
  })
  const p = (n.props ?? {}), own = { ...inherited }
  if (p.color) own.fg = color(p.color)
  if (p.backgroundColor) own.bg = color(p.backgroundColor)
  if (p.weight === 'bold' || p.bold) own.bold = true
  if (p.dimColor) own.dim = true
  if (p.inverse) { own.bg = own.fg ?? '#ddd'; own.fg = '#1e1e1e' }
  return (n.children?.length ? n.children : n.type === 'Button' && p.label ? [p.label] : []).flatMap(x => runs(x, own))
}
function lines(cells: Cell[], width: number, truncate = false): Grid {
  const out: Grid = [[]]; width = Math.max(1, width)
  for (const c of cells) {
    if (c.ch === '\n') { out.push([]); continue }
    if (out.at(-1)!.length >= width) {
      if (truncate) { out.at(-1)![width - 1] = { ...c, ch: '…' }; break }
      const last = out.at(-1)!, space = last.map(c => c.ch).lastIndexOf(' ')
      if (space > width / 2) { const tail = last.splice(space); tail.shift(); out.push(tail) } else out.push([])
    }
    out.at(-1)!.push(c)
  }
  return out
}
const size = (v: any, available: number) => typeof v === 'number' ? v : typeof v === 'string' && v.endsWith('%') ? Math.floor(parseFloat(v) * available / 100) : undefined
function natural(n: Element | string, available: number): number {
  if (typeof n === 'string') return Array.from(n).length
  const p = (n.props ?? {}), explicit = size(p.width, available)
  if (explicit !== undefined) return explicit
  if (n.type === 'Text' || n.type === 'Link' || n.type === 'Button' || n.type === 'Code' || n.type === 'Markdown') return Math.min(available, text(n).length + (n.type === 'Button' && !p.plain ? 4 : 0))
  if (n.type === 'Raster') return p.columns
  if (n.type === 'Input' || n.type === 'Select') return Math.min(available, String(n.type === 'Select' ? selectedLabel(p) : p.value || p.placeholder || '').length + String(p.label ?? '').length + 4)
  const children = (n.children ?? []).map(c => natural(c, available)), border = p.borderStyle ? 2 : 0, padding = 2 * space(p.paddingX ?? p.padding)
  return Math.min(available, (p.flexDirection === 'column' ? Math.max(0, ...children) : children.reduce((a, b) => a + b, 0) + Math.max(0, children.length - 1) * space(p.columnGap ?? p.gap)) + border + padding)
}
export function terminal(n: Element | string, available: number): Grid {
  if (typeof n === 'string') return lines(runs(n), available)
  const p = n.props ?? {}
  if (p.display === 'none') return []
  if (['Text', 'Link', 'Code', 'Markdown', 'Button', 'Select', 'Input'].includes(n.type)) {
    let cells: Cell[]
    if (n.type === 'Link') cells = runs(p.label || p.href, { fg: color('suggestion') })
    else if (n.type === 'Select' || n.type === 'Input') cells = runs(`${p.label ?? ''}[${n.type === 'Select' ? selectedLabel(p) : p.value || p.placeholder || ''}]`)
    else if (n.type === 'Code' || n.type === 'Markdown') cells = runs(p.source ?? p.text ?? text(n))
    else cells = runs(n)
    if (n.type === 'Button' && !p.plain) cells = [...runs('[ ', { fg: p.variant === 'primary' ? color('claude') : color() }), ...cells, ...runs(' ]')]
    return lines(cells, available, p.wrap?.startsWith('truncate'))
  }
  if (n.type === 'Raster') {
    const b = Buffer.from(p.cells, 'base64'), result: Grid = []
    const decode = (v: number, foreground: boolean) => v === 0x01000000 ? foreground ? '#e6e6e6' : '#1e1e1e' : '#' + (v & 0xffffff).toString(16).padStart(6, '0')
    for (let y = 0; y < p.rows; y++) {
      const row: Cell[] = []
      for (let x = 0; x < Math.min(available, p.columns); x++) { const at = (y * p.columns + x) * 12; row.push(cell(String.fromCodePoint(b.readUInt32LE(at)), decode(b.readUInt32LE(at + 4), true), decode(b.readUInt32LE(at + 8), false))) }
      result.push(row)
    }
    return result
  }
  if (n.type !== 'Box') throw new Error(`Unsupported terminal element: ${n.type}`)
  const outer = Math.max(1, Math.min(available, size(p.width, available) ?? available)), border = p.borderStyle ? 1 : 0
  const pl = space(p.paddingLeft ?? p.paddingX ?? p.padding), pr = space(p.paddingRight ?? p.paddingX ?? p.padding)
  const pt = space(p.paddingTop ?? p.paddingY ?? p.padding), pb = space(p.paddingBottom ?? p.paddingY ?? p.padding)
  const ml = space(p.marginLeft ?? p.marginX ?? p.margin), mr = space(p.marginRight ?? p.marginX ?? p.margin)
  const mt = space(p.marginTop ?? p.marginY ?? p.margin), mb = space(p.marginBottom ?? p.marginY ?? p.margin)
  const inner = Math.max(1, outer - 2 * border - pl - pr - ml - mr), children = n.children ?? [], gap = Math.floor(space(p.gap))
  const bg = color(p.backgroundColor ?? 'background'), blank = () => Array.from({ length: outer }, () => cell(' ', color(), bg))
  const result: Grid = []
  if (p.flexDirection === 'column') {
    for (const c of children) { if (result.length) for (let i = 0; i < gap; i++) result.push([]); result.push(...terminal(c, inner)) }
  } else {
    const cg = Math.floor(space(p.columnGap ?? p.gap)), rg = Math.floor(space(p.rowGap ?? p.gap)), groups: { c: Element | string; width: number }[][] = [[]]
    let used = 0
    for (const c of children) {
      const width = Math.max(1, natural(c, inner))
      if (p.flexWrap === 'wrap' && used && used + cg + width > inner) { groups.push([]); used = 0 }
      groups.at(-1)!.push({ c, width }); used += width + (used ? cg : 0)
    }
    for (const group of groups) {
      if (result.length) for (let i = 0; i < rg; i++) result.push([])
      const spare = Math.max(0, inner - group.reduce((s, x) => s + x.width, 0) - Math.max(0, group.length - 1) * cg)
      const growers = group.filter(x => typeof x.c !== 'string' && x.c.props?.flexGrow).length
      const grids = group.map(x => terminal(x.c, Math.min(inner, x.width + (growers && typeof x.c !== 'string' && x.c.props?.flexGrow ? Math.floor(spare / growers) : 0))))
      const height = Math.max(0, ...grids.map(g => g.length)), widths = grids.map(g => Math.max(0, ...g.map(r => r.length)))
      const between = p.justifyContent === 'space-between' && grids.length > 1 ? Math.max(cg, Math.floor((inner - widths.reduce((a,b)=>a+b,0)) / (grids.length - 1))) : cg
      for (let y = 0; y < height; y++) {
        const row: Cell[] = []
        if (p.justifyContent === 'flex-end') row.push(...Array.from({ length: spare }, () => cell()))
        grids.forEach((g, i) => { if (i) row.push(...Array.from({ length: between }, () => cell())); const offset = p.alignItems === 'center' ? Math.floor((height - g.length) / 2) : 0; const r = g[y - offset] ?? []; row.push(...r, ...Array.from({ length: Math.max(0, widths[i]! - r.length) }, () => cell())) })
        result.push(row.slice(0, inner))
      }
    }
  }
  const framed: Grid = Array.from({ length: mt }, blank)
  if (border) framed.push([cell('╭', color(p.borderColor)), ...Array.from({ length: outer - 2 }, () => cell('─', color(p.borderColor))), cell('╮', color(p.borderColor))])
  for (let i = 0; i < pt; i++) framed.push(blank())
  for (const r of result) {
    const row = blank(), start = ml + border + pl
    r.slice(0, inner).forEach((c, i) => row[start + i] = p.backgroundColor && c.bg === '#1e1e1e' ? { ...c, bg } : c)
    if (border) { row[0] = cell('│', color(p.borderColor)); row[outer - 1] = cell('│', color(p.borderColor)) }
    framed.push(row)
  }
  for (let i = 0; i < pb; i++) framed.push(blank())
  if (border) framed.push([cell('╰', color(p.borderColor)), ...Array.from({ length: outer - 2 }, () => cell('─', color(p.borderColor))), cell('╯', color(p.borderColor))])
  for (let i = 0; i < mb; i++) framed.push(blank())
  return framed
}
export function terminalPage(tree: Element, columns: number) {
  const grid = terminal(tree, columns)
  // Block glyphs fill whole cell halves; a browser font's line box would leave scanline gaps.
  const width = columns * 8, height = Math.max(20, grid.length * 20)
  const paint = grid.map((row, y) => row.map((c, x) => {
    const xx = x * 8, yy = y * 20, opacity = c.dim ? ' opacity=".6"' : ''
    const bg = `<rect x="${xx}" y="${yy}" width="8" height="20" fill="${c.bg}"/>`
    if (c.ch === ' ' || c.ch === '') return bg
    if (['█', '▀', '▄'].includes(c.ch)) return bg + `<rect x="${xx}" y="${yy + (c.ch === '▄' ? 10 : 0)}" width="8" height="${c.ch === '█' ? 20 : 10}" fill="${c.fg}"${opacity}/>`
    return bg + `<text x="${xx}" y="${yy + 15}" fill="${c.fg}"${c.bold ? ' font-weight="bold"' : ''}${opacity}>${escape(c.ch)}</text>`
  }).join('')).join('')
  return `<!doctype html><html><meta charset="utf-8"><style>body{margin:0;padding:12px;background:#1e1e1e}svg{display:block;font:13px Menlo,monospace}</style><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#1e1e1e"/>${paint}</svg></html>`
}
