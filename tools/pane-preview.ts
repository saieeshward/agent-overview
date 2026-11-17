/** Run: npx -y tsx tools/pane-preview.ts [run-name] [--scenario=name]
 * No runtime dependencies. Captures the real Pane through claude-code/testing in a disposable
 * plugin snapshot, then paints approximations with the installed headless Chrome.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'
import { desktopPage, terminalPage, terminal } from './pane-render'
import type { Element } from './pane-render'

const root = resolve(dirname(resolve(process.argv[1]!)), '..')
const args = process.argv.slice(2), run = args.find(a => !a.startsWith('--')) ?? `ux-1-${new Date().toISOString().replace(/[:.]/g, '-')}`
assert.match(run, /^[\w.-]+$/, 'run name must be a single directory name')
assert(run !== '.' && run !== '..', 'run name must stay inside the QA folder')
assert(!args.some(a => a.startsWith('--') && !a.startsWith('--scenario=') && !a.startsWith('--chrome=') && !a.startsWith('--compare=') && a !== '--single-process'), 'supported options: --scenario=name, --compare=run-name, --chrome=path, --single-process')
const scenario = args.find(a => a.startsWith('--scenario='))?.slice(11)
const compare = args.find(a => a.startsWith('--compare='))?.slice(10)
if (compare) { assert.match(compare, /^[\w.-]+$/); assert(compare !== '.' && compare !== '..') }
const config = { desktop: [420, 700, 1000], terminal: [64, 100, 140], scenario }
const out = join(homedir(), '.claude/worktrees/qa', run), temp = mkdtempSync(join(tmpdir(), 'pane-preview-'))
const chromePath = args.find(a => a.startsWith('--chrome='))?.slice(9) ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(out, { recursive: true })

type Capture = { surface: 'desktop' | 'terminal'; width: number; area: string; tab: string; scenario: string; tree: Element }
type Proof = Capture & { name: string; file: string; height: number; overflow: unknown[]; full?: string; offset?: number; scene?: string; svgSizes: number[] }

const svgs = (tree: Element): Element[] => [ ...(tree.type === 'Svg' ? [tree] : []), ...(tree.children ?? []).filter((c): c is Element => typeof c !== 'string').flatMap(svgs) ]
// Negative SMIL begin offsets seek the actual image-mode animation without replacing its renderer.
const offsetTree = (tree: Element, offset: number): Element => ({ ...tree, props: tree.type === 'Svg' ? { ...tree.props, source: tree.props.source.replace(/<animate(?:Transform)?\b[^>]*\/>/g, (tag: string) => {
  const old = Number(/begin="(-?[\d.]+)s"/.exec(tag)?.[1] ?? 0), begin = `begin="${old - offset}s"`
  return /begin="[^"]*"/.test(tag) ? tag.replace(/begin="[^"]*"/, begin) : tag.replace('/>', ` ${begin}/>`)
}) } : tree.props, children: tree.children?.map(c => typeof c === 'string' ? c : offsetTree(c, offset)) })

// Small painter invariants catch a silently missing renderer or an incorrectly decoded raster.
assert(desktopPage({ type: 'Svg', props: { source: '<svg width="300" height="200"></svg>', alt: 'probe' } }).includes('<img'))
assert(desktopPage({ type: 'Svg', props: { source: '<svg width="300" height="200"></svg>', alt: 'probe', isInteractive: true } }).includes('<iframe'))
const imageProbe = '<svg><image href="data:image/png;base64,probe"/><image href="probe">fallback</image><rect/></svg>'
const interactiveProbe = desktopPage({ type: 'Svg', props: { source: imageProbe, alt: 'probe', isInteractive: true } })
assert(!interactiveProbe.includes('&lt;image') && interactiveProbe.includes('&lt;rect'), 'interactive SVGs must drop images only')
assert(desktopPage({ type: 'Svg', props: { source: imageProbe, alt: 'probe' } }).includes(Buffer.from(imageProbe).toString('base64')), 'plain SVGs must retain images')
const raster = Buffer.alloc(12); raster.writeUInt32LE(0x2580, 0); raster.writeUInt32LE(0xff0000, 4); raster.writeUInt32LE(0x0000ff, 8)
assert.deepEqual(terminal({ type: 'Raster', props: { columns: 1, rows: 1, cells: raster.toString('base64') } }, 1)[0]?.[0], { ch: '▀', fg: '#ff0000', bg: '#0000ff' })

for (const label of ['Switch', 'Cancel', 'Hand off', 'Undo', '▲', '▼']) {
  assert(terminal({ type: 'Button', props: { label } }, 40).flat().map(c => c.ch).join('').includes(label))
}
assert(terminal({ type: 'Select', props: { value: 'main', options: [{ value: 'main', label: 'Main' }] } }, 40).flat().map(c => c.ch).join('').includes('[Main]'))
assert(desktopPage({ type: 'Text', props: { size: 'title' }, children: ['6'] }).includes('font-size:28px'))
assert(!desktopPage({ type: 'Input', props: { value: '', placeholder: '', submitLabel: 'set' } }).includes('<b>set</b>'))
assert.equal(terminal({ type: 'Button', props: { label: 'Hand off' } }, 20)[0]!.map(c => c.ch).join(''), '[ Hand off ]')
assert.equal(terminal({ type: 'Button', props: { label: '▲', plain: true } }, 4)[0]!.map(c => c.ch).join(''), '▲')

class CDP {
  socket: WebSocket
  id = 0
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.addEventListener('message', e => {
      const m = JSON.parse(String(e.data)), p = this.pending.get(m.id)
      if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
    })
    this.socket.addEventListener('close', () => { for (const p of this.pending.values()) p.reject(new Error('Chrome disconnected')); this.pending.clear() })
  }
  async ready() { if (this.socket.readyState === 1) return; await new Promise<void>((yes, no) => { this.socket.addEventListener('open', () => yes(), { once: true }); this.socket.addEventListener('error', () => no(new Error('Could not connect to Chrome')), { once: true }) }) }
  call(method: string, params: any = {}, sessionId?: string): Promise<any> {
    const id = ++this.id
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) })
  }
}

async function main() {
let browser: ReturnType<typeof spawn> | undefined, cdp: CDP | undefined
try {
  mkdirSync(join(temp, '.claude-plugin'))
  cpSync(join(root, '.claude-plugin/plugin.json'), join(temp, '.claude-plugin/plugin.json'))
  cpSync(join(root, 'hooks'), join(temp, 'hooks'), { recursive: true })
  cpSync(join(root, 'types'), join(temp, 'types'), { recursive: true })
  mkdirSync(join(temp, 'tools'))
  cpSync(join(root, 'tools/pane-fixtures.ts'), join(temp, 'tools/pane-fixtures.ts'))
  cpSync(join(root, scenario === 'office-rail' ? 'tools/office-rail-capture.ts' : scenario === 'chat-surfaces' ? 'tools/chat-capture.ts' : scenario === 'chat-look' ? 'tools/chat-look-capture.ts' : 'tools/pane-capture.ts'), join(temp, 'tools/pane-capture.test.ts'))
  writeFileSync(join(temp, 'tools/preview-config.ts'), `export const CONFIG = ${JSON.stringify(config)}\n`)
  process.stdout.write('Mounting preview scenarios with the Claude test kit…\n')
  const captured = spawnSync('claude', ['plugin', 'test', temp], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 240000 })
  const log = String(captured.stdout ?? '') + String(captured.stderr ?? '')
  if (captured.status !== 0) { writeFileSync(join(out, 'capture.log'), log); throw new Error(`Pane capture failed; see ${join(out, 'capture.log')}`) }
  const captures: Capture[] = log.split('\n').filter(line => line.startsWith('PANE_TREE:')).map(line => JSON.parse(line.slice(10)))
  assert(captures.length > 0, 'No preview scenarios matched')
  for (const c of captures) {
    assert(!JSON.stringify(c.tree).includes('panel error:'), `Render error: ${c.area}/${c.tab}/${c.scenario}: ${JSON.stringify(c.tree).slice(-800)}`)
    for (const svg of svgs(c.tree)) {
      assert(svg.props.source.length <= 131072, `SVG too large: ${c.scenario}/${c.width}`)
      assert(!svg.props.isInteractive || !/<image\b/i.test(svg.props.source), `Interactive SVG embeds images: ${c.scenario}/${c.width}`)
    }
  }
  writeFileSync(join(out, 'capture.log'), log.split('\n').filter(line => !line.startsWith('PANE_TREE:')).join('\n'))
  const trees = join(out, 'trees'); mkdirSync(trees, { recursive: true })
  for (const c of captures) writeFileSync(join(trees, `${c.surface}-${c.width}-${c.area}-${c.tab}-${c.scenario}.json`), JSON.stringify(c.tree))
  process.stdout.write(`Captured ${captures.length} trees. Starting headless Chrome…\n`)
  browser = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-dark-mode', '--remote-debugging-port=0', ...(args.includes('--single-process') ? ['--single-process', '--in-process-gpu', '--no-zygote', '--no-sandbox'] : []), `--user-data-dir=${join(temp, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise<string>((yes, no) => {
    let stderr = ''; const timer = setTimeout(() => no(new Error(`Chrome startup timed out: ${stderr.slice(-1500)}`)), 20000)
    browser!.once('error', e => { clearTimeout(timer); no(e) })
    browser!.once('exit', code => { clearTimeout(timer); no(new Error(`Chrome exited ${code}: ${stderr.slice(-1500)}`)) })
    browser!.stderr!.on('data', chunk => { stderr += chunk; const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr); if (match) { clearTimeout(timer); yes(match[1]!) } })
  })
  cdp = new CDP(endpoint); await cdp.ready()
  const target = await cdp.call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const call = (method: string, params: any = {}) => cdp!.call(method, params, sessionId)
  const evaluate = async (expression: string) => {
    const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  await call('Page.enable')
  async function openPage(path: string, width: number, height: number) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await call('Page.navigate', { url: pathToFileURL(path).href })
    for (let i = 0; i < 100; i++) {
      if (await evaluate(`document.readyState === 'complete' && location.href === ${JSON.stringify(pathToFileURL(path).href)}`)) break
      if (i === 99) throw new Error(`Page did not load: ${path}`)
      await new Promise(r => setTimeout(r, 20))
    }
    await evaluate('Promise.all([document.fonts.ready, ...Array.from(document.images).map(i => i.decode().catch(() => {}))]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))')
  }
  async function shot(path: string, height?: number, width?: number) {
    const r = await call('Page.captureScreenshot', { format: 'png', ...(height && width ? { captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } } : {}) })
    writeFileSync(path, Buffer.from(r.data, 'base64'))
  }
  const proofs: Proof[] = []
  for (const c of captures) {
    const room = c.surface === 'desktop' && svgs(c.tree).some(s => s.props.source.includes('data-layer="bg"'))
    const rail = c.surface === 'desktop' && svgs(c.tree).some(s => s.props.alt?.endsWith('provider office'))
    for (const offset of room || rail ? [0, 1.8, 4.4] : [0]) {
    const folder = join(out, `${c.surface}-${c.width}`); mkdirSync(folder, { recursive: true })
    const name = `${c.area === 'overview' ? 'default' : c.area}-${c.tab}-${c.scenario}${offset ? `-t${offset}` : ''}`, file = join(folder, `${name}.png`), html = join(folder, `${name}.html`)
    const width = c.surface === 'desktop' ? c.width : c.width * 8 + 24
    writeFileSync(html, c.surface === 'desktop' ? desktopPage(offset ? offsetTree(c.tree, offset) : c.tree) : terminalPage(c.tree, c.width))
    await openPage(html, width, c.surface === 'desktop' ? 900 : 1224)
    const height = await evaluate('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')
    const overflow = c.surface === 'desktop' ? await evaluate(`Array.from(document.querySelectorAll('[data-type]')).filter(e=>{let r=e.getBoundingClientRect(),left=r.left,right=r.right;for(let a=e.parentElement;a;a=a.parentElement){if(['hidden','clip'].includes(getComputedStyle(a).overflowX)){const b=a.getBoundingClientRect();left=Math.max(left,b.left);right=Math.min(right,b.right)}}return right>innerWidth-10||left<10}).map(e=>({type:e.dataset.type,key:e.dataset.key,right:Math.round(e.getBoundingClientRect().right)}))`) : []
    await shot(file)
    let full: string | undefined
    if (height > (c.surface === 'desktop' ? 900 : 1224)) { full = file.replace(/\.png$/, '-full.png'); await shot(full, height, width) }
    let scene: string | undefined
    if (room || rail) {
      const selector = rail ? 'img[alt$="provider office"]' : 'img[data-type="Svg"][alt^="Agent HQ:"],iframe[data-type="Svg"][title^="Agent HQ:"]'
      const box = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`)
      scene = file.replace(/\.png$/, '-scene.png')
      const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: box })
      writeFileSync(scene, Buffer.from(result.data, 'base64'))
    }
    proofs.push({ ...c, name, file, height, overflow, full, offset, scene, svgSizes: svgs(c.tree).map(s => s.props.source.length) })
    if (proofs.length % 12 === 0) process.stdout.write(`Painted ${proofs.length}/${captures.length}\n`)
    }
  }
  const relative = (file: string) => file.slice(out.length + 1)
  const cards = (list: Proof[]) => list.map(p => `<a href="${relative(p.full ?? p.file)}"><strong>${p.name}</strong><img src="${relative(p.file)}"></a>`).join('')
  const head = '<!doctype html><meta charset="utf-8"><style>body{margin:24px;background:#151515;color:#ddd;font:14px Menlo,monospace}h1{font-size:22px}h2{font-size:18px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}a{color:inherit;text-decoration:none;background:#252525;padding:10px;border:1px solid #444;border-radius:8px}strong{font-size:11px;display:block;overflow-wrap:anywhere;margin-bottom:8px}img{display:block;width:100%;height:auto}</style>'
  for (const width of config.desktop) {
    const rooms = proofs.filter(p => p.width === width && p.scene)
    const file = join(out, `office-scenes-${width}.html`)
    writeFileSync(file, `${head}<style>.cards{grid-template-columns:repeat(3,1fr)}img{width:auto;max-width:100%}</style><h1>Office · ${width}px · 0 / 1.8 / 4.4s</h1><div class="cards">${rooms.map(p => `<a href="${relative(p.scene!)}"><strong>${p.scenario} · ${p.offset}s · ${Math.max(...p.svgSizes)} chars</strong><img src="${relative(p.scene!)}"></a>`).join('')}</div>`)
    await openPage(file, Math.max(1360, width * 3 + 120), 900)
    await shot(file.replace(/\.html$/, '.png'), await evaluate('document.documentElement.scrollHeight'), Math.max(1360, width * 3 + 120))
  }
  writeFileSync(join(out, 'index.html'), `${head}<h1>Pane preview · ${run}</h1><p>Real mounted trees; approximate desktop and terminal painters. Open a card for the full image. Fixtures only.</p>${['desktop', 'terminal'].flatMap(surface => config[surface as keyof typeof config] && (config[surface as 'desktop' | 'terminal']).map(width => `<h2>${surface} · ${width}</h2><div class="cards">${cards(proofs.filter(p => p.surface === surface && p.width === width))}</div>`)).join('')}`)
  for (const surface of ['desktop', 'terminal'] as const) for (const width of config[surface]) {
    const items = proofs.filter(p => p.surface === surface && p.width === width), file = join(out, `contact-${surface}-${width}.html`)
    writeFileSync(file, `${head}<style>.cards{grid-template-columns:repeat(6,1fr);gap:12px}body{margin:12px}a{padding:6px}strong{height:40px;font-size:10px}img{height:440px;object-fit:contain;object-position:top}</style><h1>${surface} · ${width}</h1><div class="cards">${cards(items)}</div>`)
    await openPage(file, 1800, 900)
    const height = await evaluate('document.documentElement.scrollHeight')
    await shot(file.replace(/\.html$/, '.png'), height, 1800)
  }
  if (compare) {
    const before: Proof[] = JSON.parse(readFileSync(join(dirname(out), compare, 'audit.json'), 'utf8'))
    for (const surface of ['desktop', 'terminal'] as const) for (const width of config[surface]) {
      const file = join(out, `compare-${surface}-${width}.html`)
      const pairs = proofs.filter(p => p.surface === surface && p.width === width).map(p => {
        const old = before.find(b => b.surface === surface && b.width === width && b.name === p.name)
        return `<section><strong>${p.name}</strong><div class="pair"><div>Before${old ? `<a href="../${compare}/${old.full ?? old.file}"><img src="../${compare}/${old.file}"></a>` : '<p>New screen</p>'}</div><div>After<a href="${relative(p.full ?? p.file)}"><img src="${relative(p.file)}"></a></div></div></section>`
      }).join('')
      writeFileSync(file, `${head}<style>.pairs{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pair img{height:440px;object-fit:contain;object-position:top}section{padding:8px;background:#252525}a{padding:0;border:0}section>strong{height:28px}</style><h1>${surface} · ${width} · ${compare} → ${run}</h1><div class="pairs">${pairs}</div>`)
      await openPage(file, 1800, 900)
      await shot(file.replace(/\.html$/, '.png'), await evaluate('document.documentElement.scrollHeight'), 1800)
    }
    writeFileSync(join(out, 'comparison.html'), `${head}<h1>Before / after</h1>${['desktop', 'terminal'].flatMap(surface => config[surface as 'desktop' | 'terminal'].map(width => `<p><a href="compare-${surface}-${width}.html">${surface} · ${width}</a></p>`)).join('')}`)
  }
  writeFileSync(join(out, 'audit.json'), JSON.stringify(proofs.map(({ tree, ...p }) => ({ ...p, file: relative(p.file), full: p.full && relative(p.full), scene: p.scene && relative(p.scene) })), null, 2))
  process.stdout.write(`Done: ${proofs.length} previews, ${proofs.filter(p=>p.overflow.length).length} with horizontal overflow.\n${join(out, 'index.html')}\n`)
} finally {
  if (cdp) { await cdp.call('Browser.close').catch(() => {}); cdp.socket.close() }
  browser?.kill()
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

}
main().catch(e => { process.stderr.write(String(e.stack ?? e) + '\n'); process.exitCode = 1 })
