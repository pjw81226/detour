import { describe, expect, test } from 'claude-code/testing'

import {
  addChangedFile,
  findRecord,
  parseForkedFrom,
  patchRecord,
  titleFrom,
  treeOf,
  upsertRecord,
} from './lib/records'
import type { SideRecord } from './lib/records'

function rec(id: string, parentSessionId: string, createdAt: number): SideRecord {
  return {
    id,
    parentSessionId,
    parentMessageUuid: `m-${parentSessionId}`,
    title: `${id} 제목`,
    createdAt,
    status: 'open',
    changedFiles: [],
  }
}

describe('titleFrom', () => {
  test('긴 질문은 30자 이하로 자르고 앞부분을 남긴다', async () => {
    const title = titleFrom('이 필터는 왜 두 번 돌지? 캐시 때문인가 아니면 구독 때문인가', 0)
    expect(title.length <= 30).toBe(true)
    expect(title.startsWith('이 필터는 왜 두 번 돌지?')).toBe(true)
  })

  test('자를 때 이모지를 반쪽으로 남기지 않는다', async () => {
    const title = titleFrom(`${'가'.repeat(28)}😀😀😀`, 0)
    expect(title.includes('\ud83d…')).toBe(false)
    expect(Array.from(title).length <= 30).toBe(true)
  })

  test('질문이 없으면 HH:MM 곁가지', async () => {
    expect(/^\d{2}:\d{2} fork$/.test(titleFrom('', Date.UTC(2026, 10, 23, 5, 7)))).toBe(true)
  })
})

describe('기록 목록', () => {
  test('upsertRecord는 같은 id를 덮어쓰고 새 id는 뒤에 추가한다', async () => {
    const a = rec('A', 'R', 1)
    const b = rec('B', 'R', 2)
    const once = upsertRecord([a], b)
    expect(once.map(r => r.id)).toEqual(['A', 'B'])
    const twice = upsertRecord(once, { ...a, title: '바뀜' })
    expect(twice.map(r => r.id)).toEqual(['A', 'B'])
    expect(findRecord(twice, 'A')?.title).toBe('바뀜')
    expect(findRecord(twice, 'Z')).toBe(undefined)
  })

  test('patchRecord는 고친 필드만 바꾸고 나머지는 둔다', async () => {
    const records = patchRecord([rec('A', 'R', 1), rec('B', 'R', 2)], 'A', { status: 'returned', title: '바뀐 제목' })
    expect(findRecord(records, 'A')).toEqual({ ...rec('A', 'R', 1), status: 'returned', title: '바뀐 제목' })
    expect(findRecord(records, 'B')).toEqual(rec('B', 'R', 2))
  })

  test('addChangedFile은 같은 경로를 한 번만 남긴다', async () => {
    let records = [rec('A', 'R', 1)]
    records = addChangedFile(records, 'A', '/p/a.ts')
    records = addChangedFile(records, 'A', '/p/a.ts')
    expect(findRecord(records, 'A')?.changedFiles).toEqual(['/p/a.ts'])
  })
})

describe('treeOf', () => {
  test('맨 위 조상부터 createdAt 순으로 자식을 그린다', async () => {
    const records = [rec('D', 'A', 3), rec('B', 'A', 1), rec('C', 'B', 2)]
    const root = treeOf(records, 'C', '메인')
    expect(root.sessionId).toBe('A')
    expect(root.title).toBe('메인')
    expect(root.children.map(n => n.sessionId)).toEqual(['B', 'D'])
    expect(root.children[0]?.children.map(n => n.sessionId)).toEqual(['C'])
    expect(root.children[0]?.createdAt).toBe(1)
  })

  test('부모가 서로를 가리켜도 멈춘다', async () => {
    const cycle = [rec('A', 'B', 1), rec('B', 'A', 2)]
    const root = treeOf(cycle, 'A', '메인')
    expect(root.children.length <= 1).toBe(true)
    const self = treeOf([rec('A', 'A', 1)], 'A', '메인')
    expect(self.sessionId).toBe('A')
  })

  test('기록에 없는 세션은 자식 없는 루트 하나', async () => {
    const root = treeOf([rec('B', 'A', 1)], 'X', '메인')
    expect(root.sessionId).toBe('X')
    expect(root.children).toEqual([])
  })
})

describe('parseForkedFrom', () => {
  test('복사된 메시지 줄의 uuid를 최근 것부터 돌려준다(첨부와 시스템 줄은 뺀다)', async () => {
    // /branch는 부모의 줄을 복사하면서 줄마다 forkedFrom(그 줄 자신의 uuid)을 붙인다. 첨부와 시스템 줄에도 붙는다
    const copied = (uuid: string, type: string) => `{"uuid":"${uuid}","forkedFrom":{"sessionId":"S1","messageUuid":"${uuid}"},"type":"${type}"}`
    const lines = [
      copied('M1', 'user'),
      copied('T1', 'assistant'),
      copied('X1', 'assistant'),
      copied('Z1', 'attachment'),
      copied('Y1', 'system'),
      '{"uuid":"N1","type":"user"}',
    ]
    expect(parseForkedFrom(lines.join('\n'))).toEqual({ sessionId: 'S1', messageUuids: ['X1', 'T1', 'M1'] })
  })

  test('없으면 undefined', async () => {
    expect(parseForkedFrom('{"type":"user"}\n')).toBe(undefined)
  })
})
