import { describe, expect, test } from 'claude-code/testing'

import { findForkPoint } from './lib/transcript'
import type { FilePort } from './lib/transcript'

function file(text: string, reads: { offset: number; length: number }[] = []): FilePort {
  return {
    size: async () => text.length,
    read: async (offset, length) => {
      reads.push({ offset, length })
      return text.slice(offset, offset + length)
    },
  }
}

const forked = (uuid: string) => `{"uuid":"${uuid}","forkedFrom":{"sessionId":"S1","messageUuid":"${uuid}"},"type":"user","pad":"${'x'.repeat(30)}"}`
const own = (uuid: string) => `{"uuid":"${uuid}","type":"user","pad":"${'y'.repeat(30)}"}`

describe('findForkPoint', () => {
  test('파일이 커도 끝에서부터 나눠 읽어 마지막 forkedFrom을 찾는다', async () => {
    const lines = [...Array.from({ length: 40 }, (_, i) => forked(`M${i}`)), ...Array.from({ length: 40 }, (_, i) => own(`N${i}`))]
    const reads: { offset: number; length: number }[] = []
    const point = await findForkPoint(file(lines.join('\n'), reads), 100)
    expect(point?.messageUuids[0]).toBe('M39')
    expect(point?.sessionId).toBe('S1')
    expect(reads.every(r => r.length <= 100)).toBe(true)
  })

  test('나눈 경계에 걸린 줄도 이어 붙여 읽는다', async () => {
    const text = [forked('M1'), own('N1')].join('\n')
    expect(await findForkPoint(file(text), 7)).toEqual({ sessionId: 'S1', messageUuids: ['M1'] })
  })

  test('forkedFrom이 없으면 undefined', async () => {
    expect(await findForkPoint(file([own('N1'), own('N2')].join('\n')), 50)).toBe(undefined)
  })

  test('파일을 읽지 못하면 undefined', async () => {
    const broken: FilePort = {
      size: async () => {
        throw new Error('ENOENT')
      },
      read: async () => '',
    }
    expect(await findForkPoint(broken, 50)).toBe(undefined)
  })
})
