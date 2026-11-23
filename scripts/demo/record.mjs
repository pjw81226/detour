// README GIF 녹화. vhs는 마우스를 못 눌러서, 브라우저 터미널(ttyd)을 Chrome 개발자 프로토콜로 몰아
// 글자를 치고 옆 칸을 실제로 클릭한다. 대기는 정해진 초가 아니라 화면에 답이 끝난 표시가 뜨는 때까지다.
//
//   node scripts/demo/record.mjs en   # docs/demo.gif
//   node scripts/demo/record.mjs ko   # docs/demo.ko.gif
//
// 저장소 루트에서 돌린다. ttyd, ffmpeg, Google Chrome이 필요하다.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LANG = process.argv[2] === 'ko' ? 'ko' : 'en'
const OUT = LANG === 'ko' ? 'docs/demo.ko.gif' : 'docs/demo.gif'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const TTYD_PORT = 7681
const CDP_PORT = 9333
const WIDTH = 1300
const HEIGHT = 780
const TYPE_MS = 28
const SPEED = 1.2

const TEXT = {
  en: {
    main: 'Walk me through src/orders.js in one line',
    fork1: 'why does the filter run twice?',
    fork1a: 'how would you fix it?',
    fork2: 'is the cache key safe?',
    last: 'What did I just ask you? One line.',
  },
  ko: {
    main: 'src/orders.js 한 줄로 설명해 줘',
    fork1: '필터가 왜 두 번 돌지?',
    fork1a: '어떻게 고치면 돼?',
    fork2: '캐시 키는 안전해?',
    last: '방금 내가 뭐 물어봤지? 한 줄로',
  },
}[LANG]

// 장면 순서: 나무를 먼저 열고, fork를 여러 번 치고, 옆 칸을 클릭해 오간다
const STEPS = [
  { type: '/tree', until: 'pane' },
  { type: TEXT.main, until: 'answer' },
  { type: `/side ${TEXT.fork1}`, until: 'answer', mark: TEXT.fork1 },
  { type: `/side ${TEXT.fork1a}`, until: 'answer', mark: TEXT.fork1a },
  { click: 'main', until: 'main' },
  { type: `/side ${TEXT.fork2}`, until: 'answer', mark: TEXT.fork2 },
  { click: TEXT.fork1, until: 'fork', mark: TEXT.fork1 },
  { pause: 2000 },
  { click: 'main', until: 'main' },
  { type: TEXT.last, until: 'answer' },
  { pause: 2500 },
]

const THEME = {
  background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selectionBackground: '#585b70',
  black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7',
  cyan: '#94e2d5', white: '#bac2de', brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8',
}
const DONE = /· done \d{1,2}:\d{2}/
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const work = mkdtempSync(join(tmpdir(), 'detour-record-'))
const ttyd = spawn('ttyd', [
  '-p', String(TTYD_PORT), '-W', '-o',
  '-t', 'fontSize=15',
  '-t', `fontFamily=${LANG === 'ko' ? 'D2Coding' : 'Menlo'}`,
  '-t', `theme=${JSON.stringify(THEME)}`,
  '-t', 'disableLeaveAlert=true',
  '-t', 'disableResizeOverlay=true',
  'scripts/demo/demo.sh',
], { stdio: 'ignore' })
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(work, 'chrome')}`,
  `--window-size=${WIDTH},${HEIGHT}`, '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore' })

function finish(code) {
  ttyd.kill('SIGKILL')
  chrome.kill('SIGKILL')
  rmSync(work, { recursive: true, force: true })
  process.exit(code)
}

async function debuggerUrl() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      return (await res.json()).webSocketDebuggerUrl
    } catch {
      await sleep(200)
    }
  }
  throw new Error('Chrome이 뜨지 않았다')
}

const ws = new WebSocket(await debuggerUrl())
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
let nextId = 0
const pending = new Map()
const listeners = []
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
  } else {
    for (const fn of listeners) fn(msg)
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    nextId += 1
    pending.set(nextId, { resolve, reject })
    ws.send(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const page = (method, params) => send(method, params, sessionId)
await page('Page.enable')
await page('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
await page('Page.navigate', { url: `http://127.0.0.1:${TTYD_PORT}` })

const evaluate = async expression =>
  (await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value

// 화면(스크롤 포함)의 줄을 글로 읽는다
const screenLines = () =>
  evaluate(`(() => { const b = window.term.buffer.active; const out = [];
    for (let i = 0; i < b.length; i += 1) out.push(b.getLine(i).translateToString(true)); return out })()`)

async function waitFor(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check(await screenLines())) return
    await sleep(150)
  }
  throw new Error(`${what}을(를) ${timeoutMs}ms 안에 보지 못했다`)
}

const key = async (keyName, code, keyCode, text) => {
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...(text ? { text } : {}) })
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode })
}
const enter = () => key('Enter', 'Enter', 13, '\r')

async function typeText(text) {
  for (const ch of text) {
    await page('Input.insertText', { text: ch })
    await sleep(TYPE_MS)
  }
}

// 옆 칸(화면 오른쪽 절반)에서 글자를 찾아 그 칸을 클릭한다. 한글은 두 칸이라 칸 단위로 찾는다
async function clickInPane(text) {
  const point = await evaluate(`(() => {
    const t = window.term; const b = t.buffer.active; const target = ${JSON.stringify(text)};
    const cell = t._core._renderService.dimensions.css.cell;
    const rect = t.element.querySelector('.xterm-screen').getBoundingClientRect();
    const from = Math.floor(t.cols / 2);
    for (let y = 0; y < t.rows; y += 1) {
      const line = b.getLine(b.viewportY + y); const cells = [];
      for (let x = from; x < t.cols; x += 1) { const c = line.getCell(x); if (!c) break; if (c.getWidth() === 0) continue; cells.push({ x, ch: c.getChars() || ' ' }) }
      const k = cells.map(c => c.ch).join('').indexOf(target);
      if (k >= 0) return { x: rect.left + (cells[k].x + 1.5) * cell.width, y: rect.top + (y + 0.5) * cell.height };
    }
    return null })()`)
  if (!point) throw new Error(`옆 칸에서 "${text}"를 찾지 못했다`)
  await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await sleep(250)
  await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

// 마지막으로 mark가 나온 줄 뒤에 '· done' 줄이 있으면 답이 끝난 것이다
// 입력창 위 한 줄(fork: ... | /back to return)에도 질문이 들어 있어서 그 줄은 뺀다
const answered = mark => lines => {
  const at = lines.findLastIndex(line => line.includes(mark) && !line.includes('| /back to return'))
  return at >= 0 && lines.slice(at + 1).some(line => DONE.test(line))
}
const inMain = lines => !lines.some(line => line.includes('| /back to return'))
const inFork = title => lines => lines.some(line => line.includes(`fork: ${title}`))
const paneOpen = lines => lines.some(line => line.includes('main ● here'))

try {
  for (let i = 0; i < 100; i += 1) {
    if (await evaluate('typeof window.term !== "undefined"')) break
    await sleep(200)
  }
  await evaluate(`document.body.style.background = '${THEME.background}'; window.term.focus()`)
  // 처음 보는 폴더면 신뢰 확인 창이 뜬다(기본 선택이 "No, exit"라 아래로 한 칸)
  await waitFor(lines => lines.some(l => /trust this folder|Claude Code v/.test(l)), 40000, '시작 화면')
  if ((await screenLines()).some(l => /trust this folder/.test(l))) {
    await key('ArrowDown', 'ArrowDown', 40)
    await sleep(300)
    await enter()
  }
  await waitFor(lines => lines.some(l => /Claude Code v/.test(l)), 40000, 'Claude Code')
  await sleep(2500)

  // 여기서부터 녹화
  const frameDir = join(work, 'frames')
  spawnSync('mkdir', ['-p', frameDir])
  const frames = []
  listeners.push(msg => {
    if (msg.method !== 'Page.screencastFrame' || msg.sessionId !== sessionId) return
    const file = join(frameDir, `f${String(frames.length).padStart(5, '0')}.png`)
    writeFileSync(file, Buffer.from(msg.params.data, 'base64'))
    frames.push({ file, ts: msg.params.metadata.timestamp })
    void page('Page.screencastFrameAck', { sessionId: msg.params.sessionId })
  })
  await page('Page.startScreencast', { format: 'png', maxWidth: WIDTH, maxHeight: HEIGHT })
  await sleep(600)

  for (const step of STEPS) {
    if (step.pause) {
      await sleep(step.pause)
      continue
    }
    if (step.type) {
      await typeText(step.type)
      await sleep(200)
      await enter()
    } else {
      await clickInPane(step.click)
    }
    const check =
      step.until === 'pane' ? paneOpen
      : step.until === 'answer' ? answered(step.mark ?? step.type)
      : step.until === 'main' ? inMain
      : inFork(step.mark)
    await waitFor(check, 90000, step.type ?? step.click)
    await sleep(700)
  }
  await page('Page.stopScreencast')

  // 프레임 사이 실제 시간으로 이어 붙이고, 1.2배속, 테두리, 팔레트를 입힌다
  const list = frames.map((f, i) => {
    const next = frames[i + 1]?.ts ?? f.ts + 2.5
    return `file '${f.file}'\nduration ${Math.max(0.01, next - f.ts).toFixed(3)}`
  })
  list.push(`file '${frames.at(-1).file}'`)
  writeFileSync(join(work, 'list.txt'), list.join('\n'))
  // 터미널 화면은 색이 적어서 점찍기(dither) 없이 팔레트만 써야 GIF가 작다
  const filter = `setpts=PTS/${SPEED},fps=12,pad=${WIDTH + 36}:${HEIGHT + 36}:18:18:color=0x1e1e2e,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-vf', filter, OUT], { stdio: 'inherit' })
  if (ff.status !== 0) throw new Error('ffmpeg 실패')
  console.log(`${OUT} (${frames.length} frames)`)
  finish(0)
} catch (err) {
  console.error(String(err))
  await page('Page.captureScreenshot', { format: 'png' })
    .then(shot => writeFileSync(join(tmpdir(), `detour-record-fail-${LANG}.png`), Buffer.from(shot.data, 'base64')))
    .catch(() => {})
  finish(1)
}
