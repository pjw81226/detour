import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

import { appendedTexts, fakeSession, row, say, START, storedRecords } from './testkit'
import type { FakeSession } from './testkit'

type Engine = Parameters<Parameters<typeof test>[1]>[0]

// 메인 S1(M1)에서 /side로 S2를 열고, 곁가지에서 한 번 묻고 답한 상태까지 간다.
// 질문 창(AskUserQuestion)과 모델 호출은 흉내 내지 않는다. 플러그인이 부르면 시험이 실패한다
async function openSide($: Engine, on: On) {
  const kit = fakeSession(on)
  on('tool.call', () => ({ result: {} }))
  await $.session.start(START)
  await $.command.run({ command: 'side', args: '필터 질문' })
  await kit.clock.advance(500)
  say(kit.state, row('N1', '필터 질문'), row('N2', '캐시 때문이에요', 'assistant'))
  return kit
}

function recordOf(state: FakeSession, id: string) {
  return storedRecords(state).find(r => r.id === id)
}

describe('/back 기본 흐름', () => {
  test('묻지 않고 바로 갈라진 메인으로 돌아가고, 메인에는 아무것도 붙이지 않는다', async ($, on) => {
    const { state, clock } = await openSide($, on)
    const r = await $.command.run({ command: 'back', args: '' })
    expect(r.isTextDisplayOnly).toBe(true)
    await clock.advance(500)
    expect(state.current).toBe('S1')
    expect(appendedTexts(state)).toEqual([])
    expect(recordOf(state, 'S2')).toMatchObject({ status: 'returned' })
  })

  test('곁가지에서 바뀐 파일은 돌아온 뒤 알림으로 알려 준다', async ($, on) => {
    const { state, clock } = await openSide($, on)
    await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })
    await $.command.run({ command: 'back', args: '' })
    await clock.advance(500)
    expect(state.toasts.some(t => t.includes('/p/a.ts') && t.includes('Files changed in the fork stay changed'))).toBe(true)
  })
})

describe('/back 예외', () => {
  test('곁가지가 아니면 돌아갈 곳이 없다고 알린다', async ($, on) => {
    const { state } = fakeSession(on)
    await $.session.start(START)
    const r = await $.command.run({ command: 'back', args: '' })
    expect(r.text).toBe('Nothing to go back to')
    expect(state.runs).toEqual([])
  })

  test('곁가지의 곁가지에서는 한 단계 위 곁가지로 돌아간다', async ($, on) => {
    const { state, clock } = await openSide($, on)
    await $.command.run({ command: 'side', args: '더 깊은 질문' })
    await clock.advance(500)
    expect(state.current).toBe('S3')
    await $.command.run({ command: 'back', args: '' })
    await clock.advance(500)
    expect(state.current).toBe('S2')
  })

  test('곁가지에 있는 동안 메인이 진행됐으면 알린다', async ($, on) => {
    const { state, clock } = await openSide($, on)
    state.sessions.get('S1')?.push(row('X1'), row('X2'), row('X3'))
    await $.command.run({ command: 'back', args: '' })
    await clock.advance(500)
    expect(state.toasts.includes('The original session moved on by 3 messages while you were away. You are at its latest point')).toBe(true)
  })

  test('메인으로 돌아가지 못하면 곁가지를 열린 채로 두고 알린다', async ($, on) => {
    const { state, clock } = await openSide($, on)
    state.sessions.delete('S1')
    await $.command.run({ command: 'back', args: '' })
    await clock.advance(500)
    expect(state.current).toBe('S2')
    expect(state.toasts.includes("Couldn't go back to the original session")).toBe(true)
    expect(recordOf(state, 'S2')).toMatchObject({ status: 'open' })
  })

  test('이동이 이미 대기 중이면 바로 알린다', async ($, on) => {
    await openSide($, on)
    await $.command.run({ command: 'side', args: '또 다른 질문' })
    const r = await $.command.run({ command: 'back', args: '' })
    expect(r.text).toBe('Already waiting to switch sessions')
  })

  test('직접 /branch로 가른 세션은 복사된 마지막 메시지를 부모로 쓴다(첨부, 시스템 줄 건너뜀)', async ($, on) => {
    const kit = fakeSession(on)
    // 메시지 API는 답 하나를 첫 블록(T1)의 uuid로 보여 준다. 기록 파일에는 블록마다 줄이 있다(T1 생각, X1 글)
    kit.state.sessions.set('S9', [row('M1', 'hi'), row('T1', '메인 답', 'assistant'), row('N1', '직접 가른 질문')])
    const copied = (uuid: string, type: string) => `{"uuid":"${uuid}","forkedFrom":{"sessionId":"S1","messageUuid":"${uuid}"},"type":"${type}"}`
    kit.state.transcripts.set(
      '/t/S9.jsonl',
      [copied('M1', 'user'), copied('T1', 'assistant'), copied('X1', 'assistant'), copied('Z1', 'attachment'), copied('Y1', 'system'), '{"uuid":"N1","type":"user"}'].join('\n'),
    )
    kit.state.current = 'S9'
    await $.session.start(START)
    await $.command.run({ command: 'back', args: '' })
    await kit.clock.advance(500)
    expect(kit.state.current).toBe('S1')
    expect(recordOf(kit.state, 'S9')).toMatchObject({ parentSessionId: 'S1', parentMessageUuid: 'T1', status: 'returned' })
  })
})
