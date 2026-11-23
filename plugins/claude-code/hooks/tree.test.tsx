import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code/testing'

import { fakeSession, START, storedRecords } from './testkit'

type Engine = Parameters<Parameters<typeof test>[1]>[0]

const PANE_ID = 'detour-tree'
const PANE = {
  plugin: 'detour',
  component: 'Pane',
  requestId: PANE_ID,
  props: { title: 'forks', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// 메인 S1 → 곁가지 S2("첫 질문") → 그 곁가지 S3("둘째 질문")까지 연다. 지금 세션은 S3
async function twoLevels($: Engine, on: On) {
  const kit = fakeSession(on)
  await $.session.start(START)
  await $.command.run({ command: 'side', args: '첫 질문' })
  await kit.clock.advance(500)
  await $.command.run({ command: 'side', args: '둘째 질문' })
  await kit.clock.advance(500)
  return kit
}

function label(found: { props: Record<string, unknown> } | undefined): string {
  return String(found?.props.label ?? '')
}

test('/tree는 옆 칸을 열고 출력은 사람에게만 보인다', async ($, on) => {
  const { state } = fakeSession(on)
  await $.session.start(START)
  const r = await $.command.run({ command: 'tree', args: '' })
  expect(r.isTextDisplayOnly).toBe(true)
  expect(state.opened).toEqual([{ id: PANE_ID, title: 'forks' }])
})

test('/tree는 옆 칸이 안 보여도 명령 결과에 나무를 글로 보여 준다', async ($, on) => {
  await twoLevels($, on)
  const r = await $.command.run({ command: 'tree', args: '' })
  const text = r.text ?? ''
  expect(text.includes('main')).toBe(true)
  expect(text.includes('첫 질문')).toBe(true)
  expect(text.includes('둘째 질문')).toBe(true)
  expect(text.includes('here')).toBe(true)
})

test('옆 칸이 자리를 못 잡으면 그 이유를 알려 준다', async ($, on) => {
  const { state } = fakeSession(on)
  state.paneNotPlaced = true
  await $.session.start(START)
  const r = await $.command.run({ command: 'tree', args: '' })
  expect((r.text ?? '').includes("Couldn't open the pane")).toBe(true)
})

describe('옆 칸', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`나무를 들여쓰기로 그리고 지금 세션에만 표시한다 (${surface})`, async ($, on) => {
      await twoLevels($, on)
      const ui = await $.ui.mount({ ...PANE, surface })
      const main = label(await ui.find({ key: 'S1' }))
      const first = label(await ui.find({ key: 'S2' }))
      const second = label(await ui.find({ key: 'S3' }))
      expect(main.includes('main')).toBe(true)
      expect(first.includes('첫 질문')).toBe(true)
      expect(second.includes('둘째 질문')).toBe(true)
      expect(second.includes('here')).toBe(true)
      expect(first.includes('here')).toBe(false)
      const indent = (s: string) => s.length - s.trimStart().length
      expect(indent(main) < indent(first) && indent(first) < indent(second)).toBe(true)
      await ui.unmount()
    })
  }

  test('다른 가지를 누르면 그 세션으로 옮기고, 옆 칸은 열어 둔 채 지금 표시를 옮긴다', async ($, on) => {
    const { state, clock } = await twoLevels($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.press({ plugin: 'detour', key: 'S1', requestId: PANE_ID })
    await clock.advance(500)
    expect(state.current).toBe('S1')
    expect(state.closed).toEqual([])
    expect(label(await ui.find({ key: 'S1' })).includes('here')).toBe(true)
    expect(label(await ui.find({ key: 'S3' })).includes('here')).toBe(false)
    await ui.unmount()
  })

  test('지금 세션 줄을 누르면 아무것도 하지 않는다', async ($, on) => {
    const { state, clock } = await twoLevels($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.press({ plugin: 'detour', key: 'S3', requestId: PANE_ID })
    await clock.advance(500)
    expect(state.current).toBe('S3')
    expect(state.closed).toEqual([])
    await ui.unmount()
  })

  test('돌아온 곁가지에도 따로 표시를 붙이지 않고, 다시 들어가면 이어서 쓸 수 있다', async ($, on) => {
    const { state, clock } = await twoLevels($, on)
    const s2 = storedRecords(state).find(r => r.id === 'S2')
    state.store.set('rec:S2', { ...s2, status: 'returned' })
    state.current = 'S1'
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    // 곁가지는 언제든 다시 들어가 이어서 물을 수 있어서 끝난 곁가지라는 표시는 두지 않는다
    expect(label(await ui.find({ key: 'S2' })).includes('returned')).toBe(false)
    await $.ui.press({ plugin: 'detour', key: 'S2', requestId: PANE_ID })
    await clock.advance(500)
    expect(state.current).toBe('S2')
    expect(storedRecords(state).find(r => r.id === 'S2')?.status).toBe('open')
    await ui.unmount()
    const band = await $.ui.mount({
      plugin: 'detour',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isCollapsed: false, isWorking: false },
      surface: 'terminal',
    })
    expect((await band.find({ type: 'Text', text: /fork:/ }))?.text).toBe('fork: 첫 질문 | /back to return')
    await band.unmount()
  })
})

describe('이름 바꾸기', () => {
  const BAND = {
    plugin: 'detour',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false },
    surface: 'terminal',
  } as const

  test('이름 바꾸기를 누르면 그 줄이 입력 칸이 되고, Enter로 저장하면 새 이름이 보인다', async ($, on) => {
    const { state } = await twoLevels($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.press({ plugin: 'detour', key: 'rename:S2', requestId: PANE_ID })
    const input = await ui.find({ key: 'name:S2' })
    expect(input?.props.value).toBe('첫 질문')
    await $.ui.input({ plugin: 'detour', key: 'name:S2', text: '캐시 조사' })
    expect(storedRecords(state).find(r => r.id === 'S2')?.title).toBe('캐시 조사')
    expect(label(await ui.find({ key: 'S2' })).includes('캐시 조사')).toBe(true)
    expect(await ui.find({ key: 'name:S2' })).toBe(undefined)
    await ui.unmount()
  })

  test('맨 위 메인 줄도 이름을 바꿀 수 있다', async ($, on) => {
    await twoLevels($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.press({ plugin: 'detour', key: 'rename:S1', requestId: PANE_ID })
    await $.ui.input({ plugin: 'detour', key: 'name:S1', text: '클립 업로드 작업' })
    expect(label(await ui.find({ key: 'S1' })).includes('클립 업로드 작업')).toBe(true)
    expect(label(await ui.find({ key: 'S1' })).includes('main')).toBe(false)
    await ui.unmount()
  })

  test('지금 있는 곁가지 이름을 바꾸면 입력창 위 한 줄도 바뀐다', async ($, on) => {
    await twoLevels($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.press({ plugin: 'detour', key: 'rename:S3', requestId: PANE_ID })
    await $.ui.input({ plugin: 'detour', key: 'name:S3', text: '더 깊은 조사' })
    await ui.unmount()
    const band = await $.ui.mount(BAND)
    expect((await band.find({ type: 'Text', text: /fork:/ }))?.text).toBe('fork: 더 깊은 조사 | /back to return')
    await band.unmount()
  })

  test('빈 이름으로 저장하면 바꾸지 않고 입력 칸만 닫는다', async ($, on) => {
    const { state } = await twoLevels($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.press({ plugin: 'detour', key: 'rename:S2', requestId: PANE_ID })
    await $.ui.input({ plugin: 'detour', key: 'name:S2', text: '   ' })
    expect(storedRecords(state).find(r => r.id === 'S2')?.title).toBe('첫 질문')
    expect(await ui.find({ key: 'name:S2' })).toBe(undefined)
    await ui.unmount()
  })

  test('긴 이름은 30자로 줄인다', async ($, on) => {
    const { state } = await twoLevels($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.ui.press({ plugin: 'detour', key: 'rename:S2', requestId: PANE_ID })
    await $.ui.input({ plugin: 'detour', key: 'name:S2', text: '가'.repeat(50) })
    expect(Array.from(String(storedRecords(state).find(r => r.id === 'S2')?.title)).length).toBe(30)
    await ui.unmount()
  })
})

describe('옆 칸 줄 모양', () => {
  test('이름 바꾸기 버튼은 오른쪽 끝에 두고 이름과 띄운다', async ($, on) => {
    await twoLevels($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'row:S2' }))?.props.justifyContent).toBe('space-between')
    expect((await ui.find({ key: 'rename-box:S2' }))?.props.marginLeft).toBe(2)
    await ui.unmount()
  })

  test('이름이 칸보다 길면 다음 줄로 넘기고, 넘긴 줄을 눌러도 그 세션으로 옮긴다', async ($, on) => {
    const kit = fakeSession(on)
    await $.session.start(START)
    await $.command.run({ command: 'side', args: '캐시 때문에 필터가 두 번 도는지 확인하기' })
    await kit.clock.advance(500)
    kit.state.current = 'S1'
    await kit.clock.advance(500)
    const narrow = { ...PANE, props: { ...PANE.props, bodyColumns: 30 } }
    const ui = await $.ui.mount({ ...narrow, surface: 'terminal' })
    const second = await ui.find({ key: 'S2#1' })
    expect(second).toBeDefined()
    await $.ui.press({ plugin: 'detour', key: 'S2#1', requestId: PANE_ID })
    await kit.clock.advance(500)
    expect(kit.state.current).toBe('S2')
    await ui.unmount()
  })
})

