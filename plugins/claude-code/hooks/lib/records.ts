// 곁가지 기록과 나무 계산. $를 쓰지 않는 순수 함수만 둔다.

export type SideRecord = {
  id: string
  parentSessionId: string
  parentMessageUuid: string
  title: string
  createdAt: number
  status: 'open' | 'returned'
  changedFiles: string[]
}

export type TreeNode = {
  sessionId: string
  title: string
  status?: SideRecord['status']
  createdAt?: number
  children: TreeNode[]
}

const MAX_TITLE = 30
// 기록이 꼬여 부모가 돌고 돌아도 멈추게 하는 상한
const MAX_DEPTH = 200

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function titleFrom(question: string, now: number): string {
  const text = question.trim().replace(/\s+/g, ' ')
  if (text === '') {
    const d = new Date(now)
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())} 곁가지`
  }
  // 이모지가 반쪽으로 잘리지 않게 코드 포인트 단위로 자른다
  const chars = Array.from(text)
  return chars.length <= MAX_TITLE ? text : `${chars.slice(0, MAX_TITLE - 1).join('')}…`
}

// 사용자가 고친 이름: 공백을 정리하고 30자로 줄인다. 비어 있으면 undefined(바꾸지 않음)
export function cleanTitle(value: string): string | undefined {
  return value.trim() === '' ? undefined : titleFrom(value, 0)
}

export function findRecord(records: readonly SideRecord[], sessionId: string): SideRecord | undefined {
  return records.find(r => r.id === sessionId)
}

export function upsertRecord(records: readonly SideRecord[], rec: SideRecord): SideRecord[] {
  const exists = records.some(r => r.id === rec.id)
  return exists ? records.map(r => (r.id === rec.id ? rec : r)) : [...records, rec]
}

export function patchRecord(records: readonly SideRecord[], id: string, patch: Partial<SideRecord>): SideRecord[] {
  return records.map(r => (r.id === id ? { ...r, ...patch } : r))
}

export function addChangedFile(records: readonly SideRecord[], id: string, path: string): SideRecord[] {
  return records.map(r =>
    r.id === id && !r.changedFiles.includes(path) ? { ...r, changedFiles: [...r.changedFiles, path] } : r,
  )
}

function rootOf(records: readonly SideRecord[], sessionId: string): string {
  let current = sessionId
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const rec = findRecord(records, current)
    if (!rec) return current
    current = rec.parentSessionId
  }
  return current
}

function childrenOf(records: readonly SideRecord[], parentId: string, seen: Set<string>): TreeNode[] {
  return records
    .filter(r => r.parentSessionId === parentId && !seen.has(r.id))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(r => {
      seen.add(r.id)
      return { sessionId: r.id, title: r.title, status: r.status, createdAt: r.createdAt, children: childrenOf(records, r.id, seen) }
    })
}

export function treeOf(records: readonly SideRecord[], sessionId: string, rootTitle: string): TreeNode {
  const root = rootOf(records, sessionId)
  const seen = new Set<string>([root])
  return { sessionId: root, title: rootTitle, children: childrenOf(records, root, seen) }
}

// /branch는 부모의 줄을 복사하면서 줄마다 forkedFrom(그 줄 자신의 uuid)을 붙인다. 첨부와 시스템 줄에도 붙는다.
// 메시지(user, assistant) 줄의 uuid를 최근 것부터 돌려준다. 메시지 API가 답 하나를 첫 블록 uuid로만 알 수 있어서
// 부르는 쪽이 앞에서부터 차례로 시도한다(비공식 형식, 없으면 undefined).
const MAX_CANDIDATES = 8

export function parseForkedFrom(transcript: string): { sessionId: string; messageUuids: string[] } | undefined {
  let sessionId: string | undefined
  const uuids: string[] = []
  for (const line of transcript.split('\n')) {
    if (!line.includes('"forkedFrom"')) continue
    try {
      const row = JSON.parse(line) as { type?: unknown; uuid?: unknown; forkedFrom?: { sessionId?: unknown; messageUuid?: unknown } }
      const from = row.forkedFrom
      if (!from || typeof from.sessionId !== 'string' || typeof from.messageUuid !== 'string') continue
      if (row.type !== 'user' && row.type !== 'assistant') continue
      sessionId = from.sessionId
      uuids.push(from.messageUuid)
    } catch {
      // 잘린 줄은 건너뛴다
    }
  }
  if (sessionId === undefined) return undefined
  return { sessionId, messageUuids: uuids.slice(-MAX_CANDIDATES).reverse() }
}
