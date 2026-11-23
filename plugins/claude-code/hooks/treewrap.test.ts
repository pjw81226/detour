import { describe, expect, test } from 'claude-code/testing'

import { displayWidth, wrapLabel } from './ui/tree'

describe('displayWidth', () => {
  test('한글과 이모지는 두 칸, 영문과 기호는 한 칸', async () => {
    expect(displayWidth('ab')).toBe(2)
    expect(displayWidth('가나')).toBe(4)
    expect(displayWidth('a가😀')).toBe(5)
  })
})

describe('wrapLabel', () => {
  test('폭 안에 들어가면 한 줄 그대로', async () => {
    expect(wrapLabel('  └ 첫 질문 10:00', 30)).toEqual(['  └ 첫 질문 10:00'])
  })

  test('폭을 넘으면 띄어쓰기에서 나누고, 다음 줄은 제목 시작 위치에 맞춰 들여 쓴다', async () => {
    const lines = wrapLabel('  └ 캐시 때문에 필터가 두 번 도는지 확인 10:00', 20)
    expect(lines.length > 1).toBe(true)
    expect(lines.every(line => displayWidth(line) <= 20)).toBe(true)
    expect(lines[0]?.startsWith('  └ 캐시')).toBe(true)
    expect(lines.slice(1).every(line => line.startsWith('    ') && !line.startsWith('     '))).toBe(true)
    expect(lines.join(' ').replace(/\s+/g, ' ').includes('확인 10:00')).toBe(true)
  })

  test('띄어쓰기 없이 긴 낱말은 폭에서 끊는다', async () => {
    const lines = wrapLabel('가'.repeat(30), 20)
    expect(lines.every(line => displayWidth(line) <= 20)).toBe(true)
    expect(lines.join('').replace(/\s/g, '')).toBe('가'.repeat(30))
  })
})
