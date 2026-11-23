// 세션 전환 대기열. 명령 훅 안에서는 $.command.run을 부를 수 없어서,
// 명령은 할 일만 적고 register.tsx의 TICK_MS 타이머가 tick을 부른다.
// 플러그인은 $를 인자로 넘길 수 없으므로 필요한 기능만 SessionPort로 받는다.

export const TICK_MS = 500
// Esc로 멈추면 사용자가 다시 입력할 때까지 플러그인 명령이 거부된다. 5초쯤 다시 시도한다
export const MAX_ATTEMPTS = 10

// /back으로 돌아갈 때 돌아간 뒤 정리할 곁가지 기록
export type AfterResume = {
  recordId: string
  parentMessageUuid: string
}

export type BranchAction = { kind: 'branch'; title: string; question?: string }
export type ResumeAction = { kind: 'resume'; targetSessionId: string; after?: AfterResume }
export type Action = BranchAction | ResumeAction

export type BranchPoint = { sessionId: string; lastUuid: string }

export type SessionPort = {
  sessionId: () => Promise<string>
  lastUuid: () => Promise<string>
  runCommand: (command: string, args?: string) => Promise<unknown>
  // Claude가 메인에서 일하는 중인지. /branch, /resume은 작업 중에도 바로 실행되므로 끝날 때까지 미룬다.
  // 갈라지는 지점이 맞는 근거가 이것이다(작업이 끝난 뒤 틱에서 읽은 마지막 메시지)
  isBusy: () => Promise<boolean>
  log: (text: string) => void
}

export type Handlers = {
  onBranched: (action: BranchAction, from: BranchPoint, newSessionId: string) => Promise<void>
  onBranchFailed: (action: BranchAction) => Promise<void>
  // 끝까지 거부됐을 때(Esc로 멈춘 뒤 등)
  onBranchRefused: (action: BranchAction) => Promise<void>
  onResumed: (action: ResumeAction, ok: boolean) => Promise<void>
}

export type Queue = {
  enqueue: (action: Action) => boolean
  pendingAction: () => Action | undefined
  tick: (port: SessionPort, handlers: Handlers) => Promise<void>
}

class Refused extends Error {}

async function run(port: SessionPort, command: string, args?: string): Promise<void> {
  try {
    await port.runCommand(command, args)
  } catch (err) {
    throw new Refused(String(err))
  }
}

// 처리기 안의 오류는 기록만 한다. 세션은 이미 바뀌었으므로 실패로 다시 알리면 안 된다
async function safely(port: SessionPort, work: Promise<void>): Promise<void> {
  try {
    await work
  } catch (err) {
    port.log(`detour: 처리 중 오류 ${String(err)}`)
  }
}

async function runBranch(port: SessionPort, action: BranchAction, handlers: Handlers): Promise<void> {
  // 작업이 끝난 뒤에만 이 틱이 돌므로, 지금의 마지막 메시지가 /branch가 복사할 마지막 메시지다
  const from: BranchPoint = { sessionId: await port.sessionId(), lastUuid: await port.lastUuid() }
  await run(port, 'branch')
  const newSessionId = await port.sessionId()
  port.log(`detour: 가르기 ${from.sessionId} ${from.lastUuid} -> ${newSessionId}`)
  if (newSessionId === from.sessionId) {
    await safely(port, handlers.onBranchFailed(action))
    return
  }
  await safely(port, handlers.onBranched(action, from, newSessionId))
}

async function runResume(port: SessionPort, action: ResumeAction, handlers: Handlers): Promise<void> {
  await run(port, 'resume', action.targetSessionId)
  const ok = (await port.sessionId()) === action.targetSessionId
  await safely(port, handlers.onResumed(action, ok))
}

async function fail(port: SessionPort, action: Action, handlers: Handlers, isRefused: boolean): Promise<void> {
  if (action.kind === 'resume') await safely(port, handlers.onResumed(action, false))
  else if (isRefused) await safely(port, handlers.onBranchRefused(action))
  else await safely(port, handlers.onBranchFailed(action))
}

export function createQueue(): Queue {
  // 한 번에 하나만 기다린다. 가르기 직후 돌아가기가 끼어드는 일을 막는다
  let waiting: Action | undefined
  let running: Action | undefined
  let attempts = 0

  return {
    enqueue: action => {
      if (running !== undefined || waiting !== undefined) return false
      waiting = action
      attempts = 0
      return true
    },
    pendingAction: () => running ?? waiting,
    tick: async (port, handlers) => {
      if (running !== undefined || waiting === undefined) return
      const action = waiting
      waiting = undefined
      running = action
      if (await port.isBusy().catch(() => false)) {
        waiting = action
        running = undefined
        return
      }
      attempts += 1
      try {
        if (action.kind === 'branch') await runBranch(port, action, handlers)
        else await runResume(port, action, handlers)
      } catch (err) {
        const isRefused = err instanceof Refused
        if (isRefused && attempts < MAX_ATTEMPTS) {
          waiting = action
          return
        }
        port.log(`detour: ${action.kind} 실패 ${String(err)}`)
        await fail(port, action, handlers, isRefused)
      } finally {
        running = undefined
      }
    },
  }
}
