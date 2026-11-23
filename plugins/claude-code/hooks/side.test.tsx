import { describe, expect, test } from 'claude-code/testing'

import { fakeSession, START, storedRecords, TURN, TURN_DONE } from './testkit'

const BAND = (isWorking: boolean) => ({
  plugin: 'detour',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking },
}) as const

describe('/side', () => {
  test('질문과 함께 치면 출력은 사람에게만 보이고 곁가지를 준비한다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    const r = await $.command.run({ command: 'side', args: '이 필터는 왜 두 번 돌지?' })
    expect(r.isTextDisplayOnly).toBe(true)
    expect(state.runs).toEqual([])
    await clock.advance(500)
    expect(state.runs).toEqual([{ command: 'branch', args: '' }])
  })

  test('Claude가 일하는 중에 치면 작업이 끝날 때까지 가르지 않는다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    await $.turn.start(TURN)
    await $.command.run({ command: 'side', args: '필터 질문' })
    await clock.advance(500)
    await clock.advance(500)
    expect(state.runs).toEqual([])
    await $.turn.complete(TURN_DONE as never)
    await clock.advance(500)
    expect(state.runs).toEqual([{ command: 'branch', args: '' }])
  })

  test('가르기 대기 중에 다시 치면 거절하고 가지는 하나만 생긴다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '첫 질문' })
    const second = await $.command.run({ command: 'side', args: '둘째 질문' })
    expect(second.text).toBe('이미 곁가지로 갈 준비 중이에요')
    await clock.advance(500)
    await clock.advance(500)
    expect(state.runs.length).toBe(1)
  })

  test('갈라지면 기록을 남기고 질문을 곁가지의 첫 프롬프트로 보낸다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '이 필터는 왜 두 번 돌지?' })
    await clock.advance(500)
    expect(state.current).toBe('S2')
    expect(state.submitted).toEqual([{ text: '이 필터는 왜 두 번 돌지?', asUser: true }])
    const [rec] = storedRecords(state)
    expect(rec).toEqual({
      id: 'S2',
      parentSessionId: 'S1',
      parentMessageUuid: 'M1',
      title: '이 필터는 왜 두 번 돌지?',
      createdAt: 500,
      status: 'open',
      changedFiles: [],
    })
  })

  test('질문 없이 치면 프롬프트를 보내지 않는다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '' })
    await clock.advance(500)
    expect(state.current).toBe('S2')
    expect(state.submitted).toEqual([])
  })
})

describe('입력창 위 한 줄', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`대기 중이고 작업 중이면 기다린다고 알린다 (${surface})`, async ($, on) => {
      fakeSession(on)
      await $.session.start(START)
      await $.command.run({ command: 'side', args: '필터 질문' })
      const ui = await $.ui.mount({ ...BAND(true), surface })
      expect((await ui.find({ type: 'Text', text: /작업이 끝나면 곁가지로 가요/ }))?.text).toBe('작업이 끝나면 곁가지로 가요')
      await ui.unmount()
    })

    test(`열린 곁가지에서는 제목과 돌아가는 법을 보여 준다 (${surface})`, async ($, on) => {
      const { clock } = fakeSession(on)
      await $.session.start(START)
      await $.command.run({ command: 'side', args: '필터 질문' })
      await clock.advance(500)
      const ui = await $.ui.mount({ ...BAND(false), surface })
      expect((await ui.find({ type: 'Text', text: /곁가지:/ }))?.text).toBe('곁가지: 필터 질문 | /back 으로 메인에 돌아가기')
      await ui.unmount()
    })

    test(`설문이 떠 있으면 아무것도 더하지 않는다 (${surface})`, async ($, on) => {
      const { clock } = fakeSession(on)
      await $.session.start(START)
      await $.command.run({ command: 'side', args: '필터 질문' })
      await clock.advance(500)
      const ui = await $.ui.mount({ ...BAND(false), props: { hasSurvey: true, isCollapsed: false, isWorking: false }, surface })
      expect(await ui.find({ type: 'Text', text: /곁가지/ })).toBe(undefined)
      await ui.unmount()
    })

    test(`곁가지도 대기도 없으면 아무것도 더하지 않는다 (${surface})`, async ($, on) => {
      fakeSession(on)
      await $.session.start(START)
      const ui = await $.ui.mount({ ...BAND(false), surface })
      expect(await ui.find({ type: 'Text', text: /곁가지/ })).toBe(undefined)
      await ui.unmount()
    })
  }
})

describe('세션이 바뀌었을 때', () => {
  async function bandText($: Parameters<Parameters<typeof test>[1]>[0]) {
    const ui = await $.ui.mount({ ...BAND(false), surface: 'terminal' })
    const found = await ui.find({ type: 'Text', text: /곁가지:/ })
    await ui.unmount()
    return found?.text
  }

  test('사용자가 직접 /resume으로 메인에 가면 입력창 위 한 줄이 따라 바뀐다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '필터 질문' })
    await clock.advance(500)
    state.current = 'S1'
    await clock.advance(500)
    expect(await bandText($)).toBe(undefined)
  })

  test('직접 /resume으로 돌아온 곁가지에 들어가면 다시 열린 곁가지가 된다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '필터 질문' })
    await clock.advance(500)
    state.store.set('rec:S2', { ...storedRecords(state)[0], status: 'returned' })
    state.current = 'S1'
    await clock.advance(500)
    state.current = 'S2'
    await clock.advance(500)
    expect(storedRecords(state)[0]?.status).toBe('open')
    expect(await bandText($)).toBe('곁가지: 필터 질문 | /back 으로 메인에 돌아가기')
  })

  test('가르기가 실패해도 지금 곁가지 표시는 남기고 실패를 알린다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '필터 질문' })
    await clock.advance(500)
    state.branchFails = true
    await $.command.run({ command: 'side', args: '더 깊은 질문' })
    await clock.advance(500)
    expect(state.current).toBe('S2')
    expect(state.toasts.includes('곁가지를 열지 못했어요')).toBe(true)
    expect(await bandText($)).toBe('곁가지: 필터 질문 | /back 으로 메인에 돌아가기')
  })

  test('곁가지 첫 질문이 거부되면 입력창에 넣어 두고 알린다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    state.submitDrops = true
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '필터 질문' })
    await clock.advance(500)
    await clock.advance(500)
    expect(state.filled).toEqual(['필터 질문'])
    expect(state.toasts.includes('질문을 입력창에 넣어 뒀어요. Enter로 보내세요')).toBe(true)
  })
})

describe('Esc로 멈춘 뒤', () => {
  test('가르기가 계속 거부되면 입력창에 /side 질문을 다시 넣어 두고 알린다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    await $.session.start(START)
    state.branchRefuses = true
    await $.command.run({ command: 'side', args: '필터 질문' })
    for (let i = 0; i < 12; i += 1) await clock.advance(500)
    expect(state.current).toBe('S1')
    expect(state.filled).toEqual(['/side 필터 질문'])
    expect(state.toasts.includes('Esc로 멈춘 뒤라 바로 가르지 못했어요. Enter를 누르면 곁가지로 가요')).toBe(true)
    const again = await $.command.run({ command: 'side', args: '필터 질문' })
    expect(again.text).toBe('곁가지를 준비해요: 필터 질문')
  })
})

describe('바뀐 파일 기록', () => {
  test('실패하거나 거부된 편집은 기록하지 않는다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    on('tool.call', (_, e) => {
      const path = (e as { file_path?: string }).file_path
      if (path === '/p/fail.ts') return { result: {}, isError: true }
      if (path === '/p/denied.ts') return { deny: 'no' }
      return { result: {} }
    })
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '필터 질문' })
    await clock.advance(500)
    await $.tool.call({ tool: 'Edit', file_path: '/p/fail.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/p/denied.ts', content: 'x' }).catch(() => undefined)
    await $.tool.call({ tool: 'Write', file_path: '/p/ok.ts', content: 'x' })
    expect(storedRecords(state)[0]?.changedFiles).toEqual(['/p/ok.ts'])
  })


  test('곁가지에서 Edit, Write, NotebookEdit이 끝나면 경로를 한 번씩 남긴다', async ($, on) => {
    const { state, clock } = fakeSession(on)
    on('tool.call', () => ({ result: {} }))
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '필터 질문' })
    await clock.advance(500)
    await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Write', file_path: '/p/b.ts', content: 'x' })
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/p/c.ipynb', new_source: 'x' })
    await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'b', new_string: 'c' })
    expect(storedRecords(state)[0]?.changedFiles).toEqual(['/p/a.ts', '/p/b.ts', '/p/c.ipynb'])
  })

  test('메인(곁가지 기록 없음)에서는 아무것도 남기지 않는다', async ($, on) => {
    const { state } = fakeSession(on)
    on('tool.call', () => ({ result: {} }))
    await $.session.start(START)
    await $.tool.call({ tool: 'Edit', file_path: '/p/a.ts', old_string: 'a', new_string: 'b' })
    expect(storedRecords(state)).toEqual([])
  })
})
