// 곁가지 기록을 $.store에 기록마다 따로 저장한다(rec:<세션 ID>).
// 키 하나에 목록 전체를 쓰면 창 두 개가 서로의 기록을 덮어쓰므로 나눠 둔다.
// 플러그인은 $를 인자로 넘길 수 없어서, register.tsx가 $.store를 감싼 StorePort를 넘긴다.
import type { SideRecord } from './records'

export type StorePort = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  keys: () => Promise<string[]>
  delete: (key: string) => Promise<void>
}


export const KEY_PREFIX = 'rec:'
// 기록이 없는 세션(맨 위 메인)의 이름
export const NAME_PREFIX = 'name:'

export async function loadName(store: StorePort, sessionId: string): Promise<string | undefined> {
  const value = await store.get(`${NAME_PREFIX}${sessionId}`)
  return typeof value === 'string' ? value : undefined
}


function isRecord(value: unknown): value is SideRecord {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.parentSessionId === 'string' &&
    typeof r.parentMessageUuid === 'string' &&
    typeof r.title === 'string' &&
    typeof r.createdAt === 'number' &&
    (r.status === 'open' || r.status === 'returned') &&
    Array.isArray(r.changedFiles)
  )
}

export async function loadRecords(store: StorePort): Promise<SideRecord[]> {
  const keys = (await store.keys()).filter(key => key.startsWith(KEY_PREFIX))
  const values = await Promise.all(keys.map(key => store.get(key)))
  return values.filter(isRecord)
}

export async function saveRecord(store: StorePort, rec: SideRecord): Promise<void> {
  await store.set(`${KEY_PREFIX}${rec.id}`, rec)
}
