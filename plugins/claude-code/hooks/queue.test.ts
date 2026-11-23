import { describe, expect, test } from 'claude-code/testing'

import { createQueue, MAX_ATTEMPTS } from './lib/queue'
import type { Action, Handlers, SessionPort } from './lib/queue'

type Run = { command: string; args?: string }

type State = { id: string }

// 세션을 흉내 내는 포트: runCommand가 불리면 onRun이 세션 ID를 바꿀 수 있다
function fakePort(onRun: (run: Run, state: State) => void | Promise<void>, startId = 'S1') {
  const state: State & { busy: boolean } = { id: startId, busy: false }
  const runs: Run[] = []
  const port: SessionPort = {
    sessionId: async () => state.id,
    lastUuid: async () => 'M1',
    runCommand: async (command, args) => {
      const run: Run = args === undefined ? { command } : { command, args }
      runs.push(run)
      await onRun(run, state)
    },
    isBusy: async () => state.busy,
    log: () => {},
  }
  return { port, runs, state }
}

function recorder() {
  const seen: unknown[] = []
  const handlers: Handlers = {
    onBranched: async (action, from, newSessionId) => {
      seen.push({ kind: 'branched', action, from, newSessionId })
    },
    onBranchFailed: async action => {
      seen.push({ kind: 'branchFailed', action })
    },
    onBranchRefused: async action => {
      seen.push({ kind: 'branchRefused', action })
    },
    onResumed: async (action, ok) => {
      seen.push({ kind: 'resumed', action, ok })
    },
  }
  return { seen, handlers }
}

const BRANCH: Action = { kind: 'branch', title: 't' }
const BACK: Action = { kind: 'resume', targetSessionId: 'S1' }

describe('enqueue', () => {
  test('같은 종류가 대기 중이면 거절한다', async () => {
    const q = createQueue()
    expect(q.enqueue(BRANCH)).toBe(true)
    expect(q.enqueue(BRANCH)).toBe(false)
    expect(q.pendingAction()).toEqual(BRANCH)
  })

  test('다른 종류라도 대기 중인 작업이 있으면 거절한다', async () => {
    const q = createQueue()
    expect(q.enqueue(BRANCH)).toBe(true)
    expect(q.enqueue(BACK)).toBe(false)
  })

  test('실행 중인 작업도 대기 중으로 본다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const f = fakePort(async () => gate)
    const q = createQueue()
    q.enqueue(BRANCH)
    const running = q.tick(f.port, recorder().handlers)
    await Promise.resolve()
    expect(q.enqueue(BRANCH)).toBe(false)
    release()
    await running
    expect(q.pendingAction()).toBe(undefined)
  })
})

describe('tick', () => {
  for (const action of [BRANCH, BACK]) {
    test(`Claude가 일하는 중에는 ${action.kind}을 실행하지 않고 끝난 뒤에 실행한다`, async () => {
      const f = fakePort(() => {}, action.kind === 'resume' ? 'S2' : 'S1')
      f.state.busy = true
      const q = createQueue()
      q.enqueue(action)
      await q.tick(f.port, recorder().handlers)
      expect(f.runs).toEqual([])
      expect(q.pendingAction()).toEqual(action)
      f.state.busy = false
      await q.tick(f.port, recorder().handlers)
      expect(f.runs.length).toBe(1)
    })
  }

  test('대기열이 비어 있으면 아무것도 실행하지 않는다', async () => {
    const f = fakePort(() => {})
    await createQueue().tick(f.port, recorder().handlers)
    expect(f.runs).toEqual([])
  })

  test('가르기에 성공하면 갈라지기 전 세션과 마지막 메시지, 새 세션을 넘긴다', async () => {
    const f = fakePort((run, state) => {
      if (run.command === 'branch') state.id = 'S2'
    })
    const q = createQueue()
    const r = recorder()
    q.enqueue(BRANCH)
    await q.tick(f.port, r.handlers)
    expect(f.runs).toEqual([{ command: 'branch' }])
    expect(r.seen).toEqual([{ kind: 'branched', action: BRANCH, from: { sessionId: 'S1', lastUuid: 'M1' }, newSessionId: 'S2' }])
  })

  test('가른 뒤에도 세션 ID가 그대로면 실패로 본다', async () => {
    const f = fakePort(() => {})
    const q = createQueue()
    const r = recorder()
    q.enqueue(BRANCH)
    await q.tick(f.port, r.handlers)
    expect(r.seen).toEqual([{ kind: 'branchFailed', action: BRANCH }])
  })

  test('돌아간 세션 ID가 대상과 같으면 성공', async () => {
    const f = fakePort((run, state) => {
      if (run.command === 'resume') state.id = run.args ?? ''
    }, 'S2')
    const q = createQueue()
    const r = recorder()
    q.enqueue(BACK)
    await q.tick(f.port, r.handlers)
    expect(f.runs).toEqual([{ command: 'resume', args: 'S1' }])
    expect(r.seen).toEqual([{ kind: 'resumed', action: BACK, ok: true }])
  })

  test('돌아간 뒤에도 세션 ID가 그대로면 실패', async () => {
    const f = fakePort(() => {}, 'S2')
    const q = createQueue()
    const r = recorder()
    q.enqueue(BACK)
    await q.tick(f.port, r.handlers)
    expect(r.seen).toEqual([{ kind: 'resumed', action: BACK, ok: false }])
  })

  for (const action of [BACK, BRANCH]) {
    test(`${action.kind} 명령이 계속 거부되면 ${MAX_ATTEMPTS}번까지 시도하고 실패로 알린다`, async () => {
      const f = fakePort(() => {
        throw new Error('refused')
      }, 'S2')
      const q = createQueue()
      const r = recorder()
      q.enqueue(action)
      for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) await q.tick(f.port, r.handlers)
      expect(f.runs.length).toBe(MAX_ATTEMPTS)
      expect(r.seen).toEqual([action.kind === 'resume' ? { kind: 'resumed', action, ok: false } : { kind: 'branchRefused', action }])
    })
  }

  test('Esc로 멈춰 한 번 거부된 뒤에는 다시 시도해 성공한다', async () => {
    let refused = false
    const f = fakePort((run, state) => {
      if (!refused) {
        refused = true
        throw new Error('past a Stop')
      }
      if (run.command === 'branch') state.id = 'S2'
    })
    const q = createQueue()
    const r = recorder()
    q.enqueue(BRANCH)
    await q.tick(f.port, r.handlers)
    expect(r.seen).toEqual([])
    await q.tick(f.port, r.handlers)
    expect(r.seen.length).toBe(1)
    expect((r.seen[0] as { kind: string }).kind).toBe('branched')
  })

  test('가르기가 끝나기 전에는 다음 틱이 아무것도 시작하지 않는다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const f = fakePort(async () => gate)
    const q = createQueue()
    q.enqueue(BRANCH)
    const first = q.tick(f.port, recorder().handlers)
    // 첫 틱이 명령을 낼 때까지 기다린다(작업 중인지 확인, 세션 ID 읽기를 거친다)
    for (let i = 0; i < 20 && f.runs.length === 0; i += 1) await Promise.resolve()
    await q.tick(f.port, recorder().handlers)
    expect(f.runs.length).toBe(1)
    release()
    await first
  })

  test('돌아간 뒤 처리 중 예외가 나도 실패로 다시 알리지 않는다', async () => {
    const f = fakePort((run, state) => {
      if (run.command === 'resume') state.id = run.args ?? ''
    }, 'S2')
    const q = createQueue()
    const seen: boolean[] = []
    const handlers: Handlers = {
      ...recorder().handlers,
      onResumed: async (_action, ok) => {
        seen.push(ok)
        if (ok) throw new Error('append failed')
      },
    }
    q.enqueue(BACK)
    await q.tick(f.port, handlers)
    expect(seen).toEqual([true])
  })

  test('세션 ID를 읽다가 예외가 나도 가르기 실패로 알린다', async () => {
    const f = fakePort(() => {})
    const port = { ...f.port, sessionId: async () => { throw new Error('boom') } }
    const q = createQueue()
    const r = recorder()
    q.enqueue(BRANCH)
    await q.tick(port, r.handlers)
    expect(r.seen).toEqual([{ kind: 'branchFailed', action: BRANCH }])
  })
})
