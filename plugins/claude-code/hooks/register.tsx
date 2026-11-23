import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { View } from '../types'
import { COPY } from './lib/copy'
import { createQueue, TICK_MS } from './lib/queue'
import type { BranchAction, Handlers, SessionPort } from './lib/queue'
import { addChangedFile, cleanTitle, findRecord, titleFrom, treeOf } from './lib/records'
import type { TreeNode } from './lib/records'
import type { SideRecord } from './lib/records'
import { loadName, loadRecords, NAME_PREFIX, saveRecord } from './lib/store'
import type { StorePort } from './lib/store'
import { findForkPoint } from './lib/transcript'
import { bandLine, viewFor } from './ui/band'
import { displayWidth, PANE_ID, treeRows, wrapLabel } from './ui/tree'

const view = atom({ plugin: 'detour', key: 'view' } as const, {} as View, { shape: 'view-1' })
// 메인에서 Claude가 일하는 중인지. 모듈 변수와 달리 핫 리로드에도 남는다
const busy = atom({ plugin: 'detour', key: 'busy' } as const, false, { shape: 'busy-1' })
// 옆 칸에서 이름을 고치는 중인 줄
const editing = atom({ plugin: 'detour', key: 'editing' } as const, '', { shape: 'editing-1' })

// 프로세스(모듈)당 대기열 하나. /branch, /resume 뒤에도 같은 모듈이 살아 있다.
const queue = createQueue()
let isTicking = false

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
// 옆 칸에서 이름 바꾸기 버튼 앞 여백, 그 버튼의 테두리([ ]), 옆 칸 안쪽 여백이 차지하는 칸
const RENAME_GAP = 2
const BUTTON_CHROME = 4
const PANE_INSET = 2

type Rows = readonly { uuid?: string }[]

function asRows(value: unknown): Rows | undefined {
  return Array.isArray(value) ? (value as Rows) : undefined
}

// 맨 위 줄(메인)은 기록이 없어서 따로 저장한 이름을 쓴다
function withRootName(tree: TreeNode, name: string | undefined): TreeNode {
  return name === undefined ? tree : { ...tree, title: name }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'side', description: COPY.sideDescription, argumentHint: COPY.sideHint, immediate: true })
    await $.command.register({ name: 'back', description: COPY.backDescription })
    await $.command.register({ name: 'tree', description: COPY.treeDescription })

    const store: StorePort = {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      keys: () => $.store.keys(),
      delete: key => $.store.delete(key),
    }
    const handlers: Handlers = {
      onBranched: async (action, from, newSessionId) => {
        const rec: SideRecord = {
          id: newSessionId,
          parentSessionId: from.sessionId,
          parentMessageUuid: from.lastUuid,
          title: action.title,
          createdAt: await $.clock.now(),
          status: 'open',
          changedFiles: [],
        }
        await saveRecord(store, rec)
        await update($, view, () => ({ sessionId: newSessionId, sideTitle: action.title }))
        const question = action.question
        if (question !== undefined) {
          // 기다리면 곁가지 첫 작업이 끝날 때까지 대기열이 막히므로 결과만 나중에 본다
          const keep = async () => {
            await $.prompt.fill({ text: question })
            $.ui.toast(COPY.questionKept)
          }
          void $.prompt.submit({ text: question, asUser: true }).then(r => (r.drop !== undefined ? keep() : undefined), keep)
        }
      },
      onBranchFailed: async () => {
        const current = viewFor(await loadRecords(store), await $.session.id())
        await update($, view, () => current)
        $.ui.toast(COPY.branchFailed)
      },
      // Esc로 멈추면 사용자가 다시 입력할 때까지 플러그인 명령이 거부된다. 다시 칠 수 있게 입력창에 넣어 둔다
      onBranchRefused: async action => {
        const current = viewFor(await loadRecords(store), await $.session.id())
        await update($, view, () => current)
        await $.prompt.fill({ text: action.question === undefined ? '/side' : `/side ${action.question}` })
        $.ui.toast(COPY.sideAfterStop)
      },
      onResumed: async (action, ok) => {
        if (!ok) {
          $.ui.toast(COPY.resumeFailed)
          return
        }
        const records = await loadRecords(store)
        // /tree로 돌아온 곁가지에 다시 들어가면 열린 상태로 되돌린다
        const target = findRecord(records, action.targetSessionId)
        if (target?.status === 'returned') await saveRecord(store, { ...target, status: 'open' })
        const after = action.after
        if (after !== undefined) {
          const moved = asRows(await $.session.messages({ after: after.parentMessageUuid }))
          const rec = findRecord(records, after.recordId)
          if (rec !== undefined) {
            await saveRecord(store, { ...rec, status: 'returned' })
            if (rec.changedFiles.length > 0) $.ui.toast(`${COPY.filesNote}: ${rec.changedFiles.join(', ')}`)
          }
          if (moved !== undefined && moved.length > 0) $.ui.toast(COPY.mainMoved(moved.length))
        }
        const current = viewFor(await loadRecords(store), action.targetSessionId)
        await update($, view, () => current)
      },
    }

    if (!isTicking) {
      isTicking = true
      const port: SessionPort = {
        sessionId: () => $.session.id(),
        lastUuid: async () => {
          const rows = await $.session.messages({ last: 1 })
          return Array.isArray(rows) ? (rows.at(-1)?.uuid ?? '') : ''
        },
        runCommand: (command, args) => $.command.run(args === undefined ? { command } : { command, args }),
        isBusy: async () => (await read($, busy)) === true,
        log: text => $.ui.log(text, { to: 'debug' }),
      }
      // 사용자가 직접 /resume, /branch, /clear로 세션을 바꿔도 입력창 위 한 줄과 기록을 맞춘다
      let lastSeenId = await $.session.id()
      $.clock.every(TICK_MS, async () => {
        await queue.tick(port, handlers)
        if (queue.pendingAction() !== undefined) return
        const id = await $.session.id()
        if (id === lastSeenId) return
        lastSeenId = id
        const rec = findRecord(await loadRecords(store), id)
        if (rec?.status === 'returned') await saveRecord(store, { ...rec, status: 'open' })
        const current = viewFor(await loadRecords(store), id)
        await update($, view, () => current)
      })
    }

    const current = viewFor(await loadRecords(store), await $.session.id())
    await update($, view, () => current)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, busy, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, busy, () => false)
    return next(e)
  })

  on('session.stop', async ($, e, next) => {
    await update($, busy, () => false)
    return next(e)
  })

  // 작업 중에도 바로 받는다(immediate). 실제 가르기는 대기열이 세션이 쉴 때 한다.
  on('command.run', { command: 'side' }, async ($, e) => {
    const question = e.args.trim()
    const title = titleFrom(question, await $.clock.now())
    const action: BranchAction = question === '' ? { kind: 'branch', title } : { kind: 'branch', title, question }
    if (!queue.enqueue(action)) {
      const text = queue.pendingAction()?.kind === 'branch' ? COPY.alreadyPending : COPY.busy
      return { text, isTextDisplayOnly: true }
    }
    await update($, view, v => ({ ...v, pendingTitle: title }))
    return { text: COPY.sideQueued(title), isTextDisplayOnly: true }
  })

  // 대기열에 갈라진 세션으로 돌아가기를 넣는다(작업이 끝난 뒤 실행된다). 요약은 가져가지 않는다
  on('command.run', { command: 'back' }, async $ => {
    if (queue.pendingAction() !== undefined) return { text: COPY.busy, isTextDisplayOnly: true }
    const store: StorePort = {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      keys: () => $.store.keys(),
      delete: key => $.store.delete(key),
    }
    const id = await $.session.id()
    let rec = findRecord(await loadRecords(store), id)
    if (rec === undefined) {
      // 사용자가 직접 /branch로 가른 세션: 세션 기록의 마지막 forkedFrom이 부모다
      const { transcriptPath } = await $.session.info()
      const from = await findForkPoint({
        size: async () => (await $.fs.stat(transcriptPath)).size,
        read: async (offset, length) => String(await $.fs.read(transcriptPath, { offset, length })),
      })
      if (from === undefined) return { text: COPY.noParent, isTextDisplayOnly: true }
      // 메시지 API가 받아 주는 가장 최근 메시지를 갈라진 지점으로 쓴다(답 하나가 여러 줄일 수 있다)
      let parentUuid = from.messageUuids[0] ?? ''
      for (const uuid of from.messageUuids) {
        if (asRows(await $.session.messages({ after: uuid })) !== undefined) {
          parentUuid = uuid
          break
        }
      }
      rec = {
        id,
        parentSessionId: from.sessionId,
        parentMessageUuid: parentUuid,
        title: COPY.manualTitle,
        createdAt: await $.clock.now(),
        status: 'open',
        changedFiles: [],
      }
      await saveRecord(store, rec)
    }

    const queued = queue.enqueue({
      kind: 'resume',
      targetSessionId: rec.parentSessionId,
      after: { recordId: rec.id, parentMessageUuid: rec.parentMessageUuid },
    })
    return { text: queued ? COPY.backQueued : COPY.busy, isTextDisplayOnly: true }
  })

  // 옆 칸을 열고, 옆 칸이 안 보이는 화면에서도 알 수 있게 나무를 글로도 보여 준다
  on('command.run', { command: 'tree' }, async $ => {
    const store: StorePort = {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      keys: () => $.store.keys(),
      delete: key => $.store.delete(key),
    }
    const current = await $.session.id()
    const tree = treeOf(await loadRecords(store), current, COPY.rootTitle)
    const rows = treeRows(withRootName(tree, await loadName(store, tree.sessionId)), current)
    const opened = await $.ui.open({ id: PANE_ID, title: COPY.treeTitle })
    const note = opened.isPlaced ? COPY.treeOpened : COPY.treeNotPlaced
    return { text: [...rows.map(row => row.label), '', note].join('\n'), isTextDisplayOnly: true }
  })

  // 지금 세션이 속한 나무 하나를 그린다. 다른 가지를 누르면 그 세션으로 옮기고, 옆 칸은 열어 둔다
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    // 세션을 옮기면 view가, 이름을 고치면 editing이 바뀐다. 그리는 중에 읽어 두면 그때 이 칸도 다시 그려진다
    await read($, view)
    const editingId = await read($, editing)
    const store: StorePort = {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      keys: () => $.store.keys(),
      delete: key => $.store.delete(key),
    }
    const current = await $.session.id()
    const tree = treeOf(await loadRecords(store), current, COPY.rootTitle)
    const rows = treeRows(withRootName(tree, await loadName(store, tree.sessionId)), current)
    const { Box, Button, Input } = $.ui.resolve(e)
    // 이름 바꾸기 버튼과 그 앞 여백, 버튼 테두리를 뺀 만큼이 이름 폭이다
    const columns = typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : 40
    const labelWidth = Math.max(10, columns - displayWidth(COPY.rename) - BUTTON_CHROME - RENAME_GAP - PANE_INSET)
    const rename = async (sessionId: string, value: string) => {
      const name = cleanTitle(value)
      if (name !== undefined) {
        const rec = findRecord(await loadRecords(store), sessionId)
        if (rec !== undefined) await saveRecord(store, { ...rec, title: name })
        else await store.set(`${NAME_PREFIX}${sessionId}`, name)
        const next = viewFor(await loadRecords(store), current)
        await update($, view, () => next)
      }
      await update($, editing, () => '')
    }
    return (
      <Box flexDirection="column">
        {rows.map(row =>
          row.key === editingId ? (
            <Input
              key={`name:${row.key}`}
              label={COPY.renameLabel}
              value={row.title}
              submitLabel={COPY.save}
              autoFocus
              onSubmit={value => rename(row.key, value)}
            />
          ) : (
            <Box key={`row:${row.key}`} flexDirection="row" justifyContent="space-between" width="100%">
              <Box key={`label:${row.key}`} flexDirection="column" flexShrink={1}>
                {wrapLabel(row.label, labelWidth).map((line, i) => (
                  <Button
                    key={i === 0 ? row.key : `${row.key}#${i}`}
                    label={line}
                    plain
                    onPress={async () => {
                      if (row.isCurrent) return
                      if (!queue.enqueue({ kind: 'resume', targetSessionId: row.key })) $.ui.toast(COPY.busy)
                    }}
                  />
                ))}
              </Box>
              <Box key={`rename-box:${row.key}`} marginLeft={RENAME_GAP} flexShrink={0}>
                <Button key={`rename:${row.key}`} label={COPY.rename} dimColor onPress={() => update($, editing, () => row.key)} />
              </Box>
            </Box>
          ),
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = bandLine(await read($, view), e.props)
    if (line === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>{line}</Text>
      </Box>
    )
  })

  // 열린 곁가지에서 파일을 고치면 /back 때 알려 주려고 경로를 남긴다
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!EDIT_TOOLS.has(String(e.tool))) return result
    // 실패했거나 거부된 편집은 파일을 바꾸지 않았다
    if (result.deny !== undefined || result.isError === true) return result
    const input = e as unknown as { file_path?: unknown; notebook_path?: unknown }
    const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
    if (typeof path !== 'string') return result
    const store: StorePort = {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      keys: () => $.store.keys(),
      delete: key => $.store.delete(key),
    }
    const id = await $.session.id()
    const records = await loadRecords(store)
    if (findRecord(records, id)?.status !== 'open') return result
    const changed = findRecord(addChangedFile(records, id, path), id)
    if (changed) await saveRecord(store, changed)
    return result
  })
}
