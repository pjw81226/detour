// 시험에서 엔진(세션, 명령, 저장소, 타이머)을 흉내 낸다. 플러그인 코드는 이 파일을 쓰지 않는다.
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

export type Row = { role: 'user' | 'assistant'; text: string; toolUses: []; uuid: string }

export function row(uuid: string, text = uuid, role: Row['role'] = 'user'): Row {
  return { role, text, toolUses: [], uuid }
}

export type FakeSession = {
  current: string
  sessions: Map<string, Row[]>
  runs: { command: string; args: string }[]
  submitted: { text: string; asUser?: boolean }[]
  filled: string[]
  toasts: string[]
  transcripts: Map<string, string>
  store: Map<string, unknown>
  opened: { id: string; title: string }[]
  closed: string[]
  appendedRows: { sessionId: string; text: string }[]
  appended: () => readonly { message: { content: readonly { text?: string }[] } }[]
  appendDenies: boolean
  nextId: number
  branchFails: boolean
  branchRefuses: boolean
  submitDrops: boolean
  paneNotPlaced: boolean
}

export function fakeSession(on: On, start: Row[] = [row('M1', 'hi')]): { state: FakeSession; clock: ReturnType<typeof mock.clock> } {
  const state: FakeSession = {
    current: 'S1',
    sessions: new Map([['S1', [...start]]]),
    runs: [],
    submitted: [],
    filled: [],
    toasts: [],
    transcripts: new Map(),
    store: new Map(),
    opened: [],
    closed: [],
    appendedRows: [],
    appended: () => [],
    appendDenies: false,
    nextId: 2,
    branchFails: false,
    branchRefuses: false,
    submitDrops: false,
    paneNotPlaced: false,
  }
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: state.current }))
  on('session.info', () => ({ value: { transcriptPath: `/t/${state.current}.jsonl` } }))
  on('session.messages', (_, e) => {
    const rows = state.sessions.get(state.current) ?? []
    const args = (e ?? {}) as { last?: number; after?: string }
    if (args.after !== undefined) {
      const at = rows.findIndex(r => r.uuid === args.after)
      if (at < 0) return { value: { deny: `no row ${args.after}` } }
      return { value: rows.slice(at + 1) }
    }
    if (args.last !== undefined) return { value: rows.slice(-args.last) }
    return { value: rows }
  })
  on('command.run', { command: 'branch' }, (_, e) => {
    state.runs.push({ command: 'branch', args: e.args })
    if (state.branchRefuses) throw new Error('input is refused past a Stop')
    if (state.branchFails) return { text: 'nothing to branch yet' }
    const id = `S${state.nextId}`
    state.nextId += 1
    state.sessions.set(id, [...(state.sessions.get(state.current) ?? [])])
    state.current = id
    return { text: '' }
  })
  on('command.run', { command: 'resume' }, (_, e) => {
    state.runs.push({ command: 'resume', args: e.args })
    if (state.sessions.has(e.args)) state.current = e.args
    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    state.submitted.push({ text: e.text, asUser: (e.origin as { asUser?: boolean } | undefined)?.asUser })
    return state.submitDrops ? { drop: 'a Stop stands' } : { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    state.filled.push(e.text)
    return { isFilled: true }
  })
  on('ui.log', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: (e as { turnId: string }).turnId }))
  on('turn.complete', (_, e) => ({ text: (e as { answer?: string }).answer ?? '' }))
  on('ui.toast', (_, e) => {
    state.toasts.push(String((e as { text?: string }).text ?? e))
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    const { id, title } = e as { id: string; title: string }
    state.opened.push({ id, title })
    return { value: state.paneNotPlaced ? { isPlaced: false, reason: 'narrow' } : { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    state.closed.push((e as { id: string }).id)
    return { value: undefined }
  })
  on('fs.stat', (_, e) => {
    const path = String((e as { path?: string }).path ?? '')
    const text = state.transcripts.get(path)
    if (text === undefined) throw new Error(`ENOENT ${path}`)
    return { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  // 시험 기록은 ASCII라 글자 수가 바이트 수와 같다
  on('fs.read', (_, e) => {
    const { path, offset, length } = e as { path: string; offset?: number; length?: number }
    const text = state.transcripts.get(path)
    if (text === undefined) throw new Error(`ENOENT ${path}`)
    const start = offset ?? 0
    return { value: text.slice(start, length === undefined ? undefined : start + length) }
  })
  on('session.append', (_, e, next) => {
    if (state.appendDenies) return { deny: 'refused' }
    const message = (e as { message: { content: { text?: string }[] } }).message
    state.appendedRows.push({ sessionId: state.current, text: message.content.map(b => b.text ?? '').join('') })
    return next(e)
  })
  on('store.get', (_, e) => ({ value: state.store.get((e as { key: string }).key) }))
  on('store.keys', () => ({ value: [...state.store.keys()] }))
  on('store.delete', (_, e) => {
    state.store.delete((e as { key: string }).key)
    return { value: undefined }
  })
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    state.store.set(key, JSON.parse(JSON.stringify(value)))
    return { value: undefined }
  })
  const clock = mock.clock(on)
  return { state, clock }
}

// 곁가지 세션에 메시지를 더한다(사용자가 곁가지에서 대화한 것처럼)
export function say(state: FakeSession, ...rows: Row[]): void {
  state.sessions.set(state.current, [...(state.sessions.get(state.current) ?? []), ...rows])
}

export function appendedTexts(state: FakeSession, sessionId?: string): string[] {
  return state.appendedRows.filter(r => sessionId === undefined || r.sessionId === sessionId).map(r => r.text)
}

// 플러그인이 저장한 곁가지 기록
export function storedRecords(state: FakeSession): Record<string, unknown>[] {
  return [...state.store.entries()].filter(([key]) => key.startsWith('rec:')).map(([, value]) => value as Record<string, unknown>)
}

// Claude가 메인에서 일을 시작하고 끝내는 것을 흉내 낸다
export const TURN = { text: '일해 줘', turnId: 't-work' } as const
export const TURN_DONE = { answer: '끝', durationMs: 1, isAborted: false, turnId: 't-work', reason: 'end_turn' } as const

export const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
