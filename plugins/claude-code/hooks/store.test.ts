import { expect, test } from 'claude-code/testing'

import type { SideRecord } from './lib/records'
import { loadRecords, saveRecord } from './lib/store'
import type { StorePort } from './lib/store'

// $.store처럼 JSON으로 저장하는 메모리 저장소
function memoryStore(entries: Record<string, unknown> = {}): StorePort {
  const data = new Map<string, unknown>(Object.entries(entries))
  return {
    get: async key => data.get(key),
    set: async (key, value) => {
      data.set(key, JSON.parse(JSON.stringify(value)))
    },
    keys: async () => [...data.keys()],
    delete: async key => {
      data.delete(key)
    },
  }
}

function rec(id: string): SideRecord {
  return {
    id,
    parentSessionId: 'R',
    parentMessageUuid: 'm1',
    title: `${id} 제목`,
    createdAt: 1,
    status: 'open',
    changedFiles: [],
  }
}

test('기록마다 따로 저장하고 전부 다시 읽는다', async () => {
  const store = memoryStore()
  await saveRecord(store, rec('A'))
  await saveRecord(store, rec('B'))
  expect((await loadRecords(store)).map(r => r.id).sort()).toEqual(['A', 'B'])
})

test('같은 기록을 다시 저장하면 덮어쓴다', async () => {
  const store = memoryStore()
  await saveRecord(store, rec('A'))
  await saveRecord(store, { ...rec('A'), status: 'returned' })
  expect(await loadRecords(store)).toEqual([{ ...rec('A'), status: 'returned' }])
})

test('다른 창이 저장한 기록을 지우지 않는다', async () => {
  // 창 1이 읽은 뒤 창 2가 B를 저장하고, 창 1이 A를 저장해도 B가 남는다
  const store = memoryStore()
  await saveRecord(store, rec('A'))
  const seenByWindow1 = await loadRecords(store)
  await saveRecord(store, rec('B'))
  await saveRecord(store, { ...(seenByWindow1[0] as SideRecord), status: 'returned' })
  expect((await loadRecords(store)).map(r => r.id).sort()).toEqual(['A', 'B'])
})

test('아무것도 없으면 빈 기록', async () => {
  expect(await loadRecords(memoryStore())).toEqual([])
})

test('모양이 틀린 기록 하나만 빼고 나머지는 읽는다', async () => {
  const store = memoryStore({ 'rec:bad': { id: 'bad', status: 'weird' }, 'rec:str': 'x', other: rec('Z') })
  await saveRecord(store, rec('A'))
  expect((await loadRecords(store)).map(r => r.id)).toEqual(['A'])
})
