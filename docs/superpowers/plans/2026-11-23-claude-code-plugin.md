# 대화 가지 관리 Claude Code 플러그인 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/side`, `/back`, `/tree` 세 명령으로 곁가지를 열고, 요약을 가져갈지 물은 뒤 갈라진 메인 세션으로 돌아오는 Claude Code 플러그인(mod)을 구현한다.

**Architecture:** 엔진이 주는 `$`만 쓰는 hooks 모듈 하나(`register.tsx`)가 훅을 연결하고, 순수 함수(기록, 요약 문구)와 `$`를 쓰는 얇은 층(저장, 대기열, 화면)을 파일별로 나눈다. `/branch`와 `/resume`은 명령 훅 안에서 직접 부를 수 없으므로 모든 세션 전환은 대기열에 적고 500ms 타이머가 실행한다. 곁가지 기록의 기준은 `$.store`이고, 세션 기록 파일의 `forkedFrom`은 사용자가 직접 `/branch`로 가른 세션에서 `/back`할 때만 보조로 참고한다.

**Tech Stack:** TypeScript(TSX), Claude Code 2.1.330 mod API(`claude-code`, `claude-code/testing`), `claude plugin validate`, `claude plugin test`, Python 3 표준 라이브러리(실제 왕복 시험 스크립트).

**Spec:** `docs/superpowers/specs/2026-11-23-conversation-branches-design.md`

## Global Constraints

- 범위는 A(Claude Code 플러그인)만이다. B(Orca 플러그인)는 이 계획에 없다.
- 플러그인 폴더: `plugins/claude-code`. `plugin.json`의 `name`은 `detour`, `license`는 `MIT`.
- 명령 이름: `side`, `back`, `tree`. `side`만 `immediate: true`로 등록한다.
- 모듈은 DOM과 Node 없이 `$`로만 동작한다. 플러그인 밖 파일은 import할 수 없으므로 설계 문서의 `core/`는 지금 만들지 않고 `hooks/lib/`에 둔다(B를 시작할 때 분리).
- 명령 훅 안에서 `$.command.run`을 부르지 않는다. 세션 전환은 `hooks/lib/queue.ts`의 대기열과 `TICK_MS = 500` 타이머로만 한다.
- 요약은 5줄 이하, 첫 줄은 `[곁가지 "<제목>"에서 알아낸 것]`, 마지막 줄은 `- 메인 작업에 주는 영향: ...`.
- `/side`, `/back`, `/tree`의 명령 출력은 모두 `isTextDisplayOnly: true`로 돌려준다(메인에 모델이 읽는 줄을 늘리지 않는다).
- 화면 문구는 전부 `hooks/lib/copy.ts` 한 곳에 둔다. 설계 문서의 문구를 그대로 쓴다: `작업이 끝나면 곁가지로 가요`, `곁가지: <제목> | /back 으로 메인에 돌아가기`.
- 확인 질문 선택지는 `가져가기`, `고쳐서 가져가기`, `안 가져가기` 셋이다.
- 커밋은 사용자가 요청할 때만 한다. 각 작업의 커밋 단계는 명령어를 제시하고 멈춘다. `git add`는 경로를 명시하고, 커밋 메시지에 AI 트레일러를 넣지 않는다.

## Review Focus

1. 곁가지 안에서 compact가 일어나 `$.session.messages({ after: parentMessageUuid })`가 `{ deny }`를 돌려준다. 기대 동작: 멈추지 않고 최근 메시지 40개로 요약한다. (Task 4)
2. `/side`를 두 번 연달아 쳐서 첫 번째 가르기가 아직 실행되지 않았다. 기대 동작: 두 번째는 `이미 곁가지로 갈 준비 중이에요`로 거절하고, 가지는 하나만 생긴다. (Task 3)
3. `/resume` 대상 세션 기록 파일이 지워졌거나 열리지 않아 실행 뒤에도 세션 ID가 그대로다. 기대 동작: 요약을 붙이지 않고, 기록을 열림 상태로 두고, `메인 세션으로 돌아가지 못했어요`를 알린다. (Task 2)
4. `$.store`에 모양이 다르거나 이전 버전 기록이 남아 있다. 기대 동작: 빈 기록으로 보고 계속 동작한다. (Task 1)
5. Claude가 곁가지에서 일하는 도중에 `/back`을 친다. 기대 동작: `back`은 immediate가 아니므로 작업이 끝난 뒤 실행된다. 요약은 끝난 작업까지 포함한다. (Task 4)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `plugins/claude-code/.claude-plugin/plugin.json` | 이름, 버전, 설명, MIT, `types`, `userConfig.summaryModel` |
| `plugins/claude-code/hooks/hooks.json` | `{ "modules": ["./register.tsx"] }` |
| `plugins/claude-code/hooks/register.tsx` | 훅 연결만 한다. 로직은 lib와 ui에 둔다 |
| `plugins/claude-code/hooks/lib/records.ts` | 곁가지 기록 타입과 순수 함수 |
| `plugins/claude-code/hooks/lib/store.ts` | `$.store` 읽기와 쓰기, 모양 검사 |
| `plugins/claude-code/hooks/lib/queue.ts` | 대기열, 타이머 실행기, 전환 성공 판정 |
| `plugins/claude-code/hooks/lib/summary.ts` | 요약 프롬프트, 요약 호출, 메인에 붙일 문구 |
| `plugins/claude-code/hooks/lib/copy.ts` | 화면 문구 상수 |
| `plugins/claude-code/hooks/ui/band.tsx` | 입력창 위 한 줄 |
| `plugins/claude-code/hooks/ui/tree.tsx` | `/tree` 옆 칸 |
| `plugins/claude-code/types/index.d.ts` | `$.state` 계약(`view`) |
| `plugins/claude-code/hooks/*.test.ts(x)` | `claude plugin test` 단위 시험 |
| `scripts/e2e.py` | 별도 Claude Code를 가상 터미널로 띄워 실제 왕복 확인 |
| `LICENSE`, `README.md`, `README.ko.md` | 저장소 루트 |

모든 경로는 저장소 루트 기준이다.

## 검증 명령

- 구조 검사: `claude plugin validate plugins/claude-code` → 마지막 줄 `✔ Validation passed` (README, LICENSE, 아이콘 관련 플러그인 디렉터리 경고는 무시한다)
- 단위 시험: `claude plugin test plugins/claude-code` → 실패 0
- 타입 검사(선택): plugin-authoring 스킬을 로드하면 그 세션의 `claude-code.d.ts` 경로와 헤더의 `tsconfig.json`이 나온다. 그 tsconfig를 플러그인 폴더 밖에 두고 `npx -y -p typescript tsc -p <그 tsconfig>`로 검사한다.

---

### Task 1: 플러그인 골격과 곁가지 기록

**Files:**
- Create: `plugins/claude-code/.claude-plugin/plugin.json`, `plugins/claude-code/hooks/hooks.json`, `plugins/claude-code/hooks/register.tsx`, `plugins/claude-code/hooks/lib/records.ts`, `plugins/claude-code/hooks/lib/store.ts`, `plugins/claude-code/hooks/lib/copy.ts`, `plugins/claude-code/types/index.d.ts`, `LICENSE`
- Test: `plugins/claude-code/hooks/records.test.ts`, `plugins/claude-code/hooks/store.test.ts`

**Interfaces:**
- Produces (`records.ts`):
  ```ts
  export type SideRecord = {
    id: string                    // 곁가지 세션 ID
    parentSessionId: string
    parentMessageUuid: string     // 갈라진 순간 부모의 마지막 메시지
    title: string
    createdAt: number             // ms
    status: 'open' | 'returned'
    carried: boolean
    lastSummarizedUuid?: string
    summaries: string[]
    changedFiles: string[]
  }
  export type TreeNode = { sessionId: string; title: string; status?: SideRecord['status']; children: TreeNode[] }
  export function titleFrom(question: string, now: number): string
  export function findRecord(records: readonly SideRecord[], sessionId: string): SideRecord | undefined
  export function upsertRecord(records: readonly SideRecord[], rec: SideRecord): SideRecord[]
  export function patchRecord(records: readonly SideRecord[], id: string, patch: Partial<SideRecord>): SideRecord[]
  export function addChangedFile(records: readonly SideRecord[], id: string, path: string): SideRecord[]
  export function treeOf(records: readonly SideRecord[], sessionId: string, rootTitle: string): TreeNode
  export function parseForkedFrom(transcriptHead: string): { sessionId: string; messageUuid: string } | undefined
  ```
- Produces (`store.ts`): `STORE_KEY = 'records'`, `loadRecords($): Promise<SideRecord[]>`, `saveRecords($, records: readonly SideRecord[]): Promise<void>`. 저장 모양은 `{ version: 1, records }`.
- Produces (`copy.ts`): 이 계획에 나오는 화면 문구 전부를 `COPY` 객체 상수로.
- Produces (`types/index.d.ts`): `PluginState['detour'] = { view: Shaped<View> }`, `View = { pendingTitle?: string; sideTitle?: string }`.

- [ ] **Step 1: 기록 함수의 실패하는 시험 작성** (`records.test.ts`)
  - `titleFrom`: `titleFrom('이 필터는 왜 두 번 돌지? 캐시 때문인가 아니면 구독 때문인가', 0)`의 길이가 30자 이하이고 `이 필터는 왜 두 번 돌지?`로 시작한다. `titleFrom('', 시각)`은 `HH:MM 곁가지` 꼴이다.
  - `upsertRecord`는 같은 `id`를 덮어쓰고, 다른 `id`는 뒤에 추가한다.
  - `addChangedFile`은 같은 경로를 두 번 넣어도 한 번만 남긴다.
  - `treeOf`: 기록 `B(parent=A)`, `C(parent=B)`, `D(parent=A)`에서 `treeOf(records, 'C', '메인')`의 루트는 `A`, 루트 제목은 `메인`, `A.children`는 `B`, `D` 순서(createdAt 순), `B.children`은 `C`다. 기록에 없는 세션 `X`는 자식 없는 루트 `X` 하나다.
  - `parseForkedFrom`: `{"forkedFrom":{"sessionId":"S1","messageUuid":"M1"}}`가 들어 있는 줄에서 `{ sessionId: 'S1', messageUuid: 'M1' }`, 없으면 `undefined`.
- [ ] **Step 2: 실패 확인**: `claude plugin test plugins/claude-code` → `records.test.ts` 실패(모듈 없음)
- [ ] **Step 3: 골격 파일 작성.** `plugin.json`은 `{ "name": "detour", "version": "0.1.0", "description": "Branch a side question off your Claude Code session and come back with only what you learned", "license": "MIT", "types": "./types/index.d.ts", "userConfig": { "summaryModel": { "type": "string", "description": "요약에 쓸 모델. 비우면 세션과 같은 모델", "default": "" } } }`. `userConfig` 형식은 validate가 거부하면 엔진 메시지대로 고친다. `register.tsx`는 이 단계에서 `session.start`에 세 명령 등록만 한다. `LICENSE`는 MIT 전문.
- [ ] **Step 4: `records.ts` 구현.** 모두 새 배열을 돌려주는 순수 함수. `parseForkedFrom`은 정규식 한 번으로 찾는다.
- [ ] **Step 5: 저장소 시험 작성** (`store.test.ts`): `mock.store`로 (a) `saveRecords` 뒤 `loadRecords`가 같은 배열을 돌려준다, (b) 저장값이 `{ version: 2, records: [...] }`이거나 배열이거나 문자열이면 `[]`를 돌려주고 예외를 던지지 않는다(Review Focus 4).
- [ ] **Step 6: `store.ts` 구현 후 통과 확인**: `claude plugin test ...` → 통과, `claude plugin validate ...` → `✔ Validation passed`
- [ ] **Step 7: 커밋 명령어 제시**
  ```bash
  git add LICENSE plugins/claude-code/.claude-plugin/plugin.json plugins/claude-code/hooks/hooks.json plugins/claude-code/hooks/register.tsx plugins/claude-code/hooks/lib/records.ts plugins/claude-code/hooks/lib/store.ts plugins/claude-code/hooks/lib/copy.ts plugins/claude-code/types/index.d.ts plugins/claude-code/hooks/records.test.ts plugins/claude-code/hooks/store.test.ts && git commit -m "feat: 플러그인 골격과 곁가지 기록"
  ```

### Task 2: 세션 전환 대기열

**Files:**
- Create: `plugins/claude-code/hooks/lib/queue.ts`
- Modify: `plugins/claude-code/hooks/register.tsx` (`session.start`에서 `startRunner` 호출)
- Test: `plugins/claude-code/hooks/queue.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  ```ts
  export const TICK_MS = 500
  export type AfterResume = { mode: 'carry' | 'edit' | 'none'; text?: string; recordId: string; parentMessageUuid: string }
  export type Action =
    | { kind: 'branch'; title: string; question?: string }
    | { kind: 'resume'; targetSessionId: string; after?: AfterResume }
  export type Handlers = {
    onBranched: ($: any, action: Extract<Action, { kind: 'branch' }>, from: { sessionId: string; lastUuid: string }, newSessionId: string) => Promise<void>
    onResumed: ($: any, action: Extract<Action, { kind: 'resume' }>, ok: boolean) => Promise<void>
  }
  export function enqueue(action: Action): boolean   // 같은 kind가 대기 중이면 false
  export function pendingAction(): Action | undefined
  export function startRunner($: any, handlers: Handlers): void  // 프로세스당 한 번만 타이머 시작
  ```
  `$`의 정확한 타입은 `claude-code`의 엔진 인터페이스 타입을 쓴다.

- [ ] **Step 1: 실패하는 시험 작성** (`queue.test.ts`, `mock.clock` 사용, `command.run`과 `session.id`, `session.messages` 훅이 엔진을 대신한다)
  - `enqueue({ kind: 'branch', title: 't' })`가 `true`, 바로 한 번 더 넣으면 `false`.
  - 타이머를 499ms 진행하면 `command.run`이 불리지 않고, 1ms 더 진행하면 `{ command: 'branch' }`로 한 번 불린다.
  - 가르기 전 `session.id`가 `S1`, 마지막 메시지 uuid가 `M1`, 실행 뒤 `S2`이면 `onBranched`가 `from = { sessionId: 'S1', lastUuid: 'M1' }`, `newSessionId = 'S2'`로 불린다.
  - `{ kind: 'resume', targetSessionId: 'S1' }` 실행 뒤 `session.id`가 `S1`이면 `onResumed(..., true)`, `S2` 그대로면 `onResumed(..., false)`(Review Focus 3).
  - `command.run`이 거부(reject)하면 `onResumed(..., false)` 또는 대기열 비우기 뒤 다음 틱에 다시 실행하지 않는다.
- [ ] **Step 2: 실패 확인**: `claude plugin test ...` → `queue.test.ts` 실패
- [ ] **Step 3: `queue.ts` 구현.** 모듈 변수 하나에 대기 중 작업을 두고, `startRunner`는 `$.clock.every(TICK_MS, ...)`를 한 번만 건다(모듈 변수 플래그). 가르기 전 마지막 uuid는 `$.session.messages({ last: 1 })`의 첫 행 `uuid`로 읽는다. 실행은 `$.command.run({ command: 'branch' })`와 `$.command.run({ command: 'resume', args: targetSessionId })`.
- [ ] **Step 4: 통과 확인**: `claude plugin test ...` → 통과
- [ ] **Step 5: 커밋 명령어 제시**
  ```bash
  git add plugins/claude-code/hooks/lib/queue.ts plugins/claude-code/hooks/register.tsx plugins/claude-code/hooks/queue.test.ts && git commit -m "feat: 세션 전환 대기열"
  ```

### Task 3: `/side`와 입력창 위 한 줄

**Files:**
- Create: `plugins/claude-code/hooks/ui/band.tsx`
- Modify: `plugins/claude-code/hooks/register.tsx`
- Test: `plugins/claude-code/hooks/side.test.tsx`

**Interfaces:**
- Consumes: `records.ts` 전부, `loadRecords`/`saveRecords`, `enqueue`/`pendingAction`/`Handlers.onBranched`, `COPY`
- Produces: `view` 상태 갱신 함수 `refreshView($): Promise<void>` (`register.tsx` 안, Task 4와 5도 씀). `pendingTitle`은 가르기 대기 중일 때, `sideTitle`은 지금 세션이 열린 곁가지일 때 채운다.

- [ ] **Step 1: 실패하는 시험 작성** (`side.test.tsx`)
  - `/side 이 필터는 왜 두 번 돌지?` 실행 결과가 `isTextDisplayOnly: true`이고, `enqueue`된 작업이 `{ kind: 'branch', title: '이 필터는 왜 두 번 돌지?', question: '이 필터는 왜 두 번 돌지?' }`다.
  - 가르기 대기 중 다시 `/side`를 치면 결과 텍스트가 `COPY.alreadyPending`(`이미 곁가지로 갈 준비 중이에요`)이고 대기열은 그대로다(Review Focus 2).
  - `onBranched`가 불리면 `$.store`에 `{ id: 'S2', parentSessionId: 'S1', parentMessageUuid: 'M1', status: 'open', carried: false, summaries: [], changedFiles: [] }` 기록이 생기고, `question`이 있으면 `prompt.submit`이 `{ text: question, asUser: true }`로 한 번 불린다. 질문이 없으면 불리지 않는다.
  - 입력창 위 한 줄(`AbovePrompt`, `terminal`과 `desktop` 두 곳): 대기 중이고 `isWorking: true`면 `작업이 끝나면 곁가지로 가요`, 지금 세션이 열린 곁가지면 `곁가지: 이 필터는 왜 두 번 돌지? | /back 으로 메인에 돌아가기`, 둘 다 아니면 `next(e)` 결과(엔진 기본)를 그대로 돌려준다. `hasSurvey: true`면 항상 `next(e)`.
  - 곁가지 세션에서 `Edit` 도구 호출(`file_path: '/p/a.ts'`)이 끝나면 그 기록의 `changedFiles`에 `/p/a.ts`가 들어간다. `Write`, `NotebookEdit`도 같다. 메인 세션(기록 없음)에서는 아무것도 바뀌지 않는다.
- [ ] **Step 2: 실패 확인**: `claude plugin test ...` → `side.test.tsx` 실패
- [ ] **Step 3: `register.tsx`에 `side` 명령(`immediate: true`, `argumentHint: '[질문]'`), `onBranched`, `tool.call` 파일 추적, `AbovePrompt` 연결.** 한 줄 그리기는 `ui/band.tsx`의 `renderBand($, e, next)`로 분리한다. `view`는 `atom({ plugin: 'detour', key: 'view' } as const, {}, { shape: 'view-1' })`.
- [ ] **Step 4: 통과 확인**: `claude plugin test ...` → 통과, `claude plugin validate ...` → 통과
- [ ] **Step 5: 커밋 명령어 제시**
  ```bash
  git add plugins/claude-code/hooks/ui/band.tsx plugins/claude-code/hooks/register.tsx plugins/claude-code/hooks/side.test.tsx && git commit -m "feat: /side 명령과 입력창 위 한 줄"
  ```

### Task 4: `/back`과 요약 가져가기

**Files:**
- Create: `plugins/claude-code/hooks/lib/summary.ts`
- Modify: `plugins/claude-code/hooks/register.tsx`
- Test: `plugins/claude-code/hooks/summary.test.ts`, `plugins/claude-code/hooks/back.test.tsx`

**Interfaces:**
- Consumes: Task 1~3의 전부
- Produces (`summary.ts`):
  ```ts
  export const MAX_LINES = 5
  export const FALLBACK_LAST = 40
  export function buildSummaryPrompt(input: { title: string; firstSideText: string; isFollowUp: boolean }): string
  export function clampLines(text: string, max?: number): string
  export function formatCarried(title: string, summary: string): string
  export async function summarize($: any, input: { title: string; sideMessages: readonly SessionMessage[]; isFollowUp: boolean; model: string }):
    Promise<{ ok: true; text: string } | { ok: false; reason: string }>
  ```
  `model`이 빈 문자열이면 `$.model.fork({ prompt })`(세션과 같은 모델, 캐시 사용), 아니면 `$.model.complete({ model, prompt })`에 곁가지 메시지를 글로 붙여 보낸다.

- [ ] **Step 1: 요약 문구 시험 작성** (`summary.test.ts`)
  - `formatCarried('필터 질문', '- 캐시 때문에 두 번 돈다\n- 메인 작업에 주는 영향: 캐시 끄고 재현')`가 정확히 `[곁가지 "필터 질문"에서 알아낸 것]\n- 캐시 때문에 두 번 돈다\n- 메인 작업에 주는 영향: 캐시 끄고 재현`.
  - `clampLines`는 7줄짜리 요약을 5줄로 자르되 `- 메인 작업에 주는 영향:`으로 시작하는 줄이 있으면 그 줄을 마지막 줄로 남긴다.
  - `buildSummaryPrompt`의 결과에 제목, `firstSideText`의 앞부분, `5줄 이하`, `- 메인 작업에 주는 영향:`이 들어 있다. `isFollowUp: true`면 `지난 요약 이후`라는 말이 들어 있다.
  - `summarize`는 `model.fork`가 `{ isAnswered: false, reason: 'empty-reply' }`면 `{ ok: false, reason: 'empty-reply' }`.
- [ ] **Step 2: 실패 확인 후 `summary.ts` 구현, 통과 확인**: `claude plugin test ...`
- [ ] **Step 3: `/back` 흐름 시험 작성** (`back.test.tsx`, `AskUserQuestion` 도구 호출과 `model.fork`, `command.run`, `session.*` 훅이 엔진을 대신한다)
  - 기록 없는 세션이고 세션 기록 첫 부분에 `forkedFrom`도 없으면 결과 텍스트가 `돌아갈 곳이 없어요`, 대기열은 비어 있다.
  - 열린 곁가지 `S2(parent=S1, M1)`에서 `가져가기`를 고르면 대기열에 `{ kind: 'resume', targetSessionId: 'S1', after: { mode: 'carry', text: formatCarried(...), recordId: 'S2', parentMessageUuid: 'M1' } }`. `onResumed(..., true)` 뒤 `mock.session`에 `type: 'user'` 행 하나가 붙고 내용이 그 `text`다. 기록은 `status: 'returned'`, `carried: true`, `summaries`에 그 텍스트, `lastSummarizedUuid`는 곁가지의 마지막 uuid.
  - `고쳐서 가져가기`면 붙이지 않고 `prompt.fill`이 그 텍스트로 불리며 `COPY.editHint`(`고친 뒤 Enter로 보내세요`) 알림이 뜬다.
  - `안 가져가기`면 아무것도 붙이지 않고 `carried: false`로 돌아온다.
  - 질문 창을 닫으면(`ask` 거부) 대기열이 비어 있고 결과 텍스트가 `취소했어요`, 기록은 그대로다.
  - `changedFiles`가 `['/p/a.ts']`면 질문 문구에 `/p/a.ts`와 `곁가지에서 바뀐 파일은 그대로 남아요`가 들어 있다.
  - `lastSummarizedUuid`가 있고 그 뒤 메시지가 없으면 요약과 질문 없이 바로 `resume`(`mode: 'none'`)이 대기열에 들어간다. 그 뒤 메시지가 있으면 `isFollowUp: true`로 요약한다.
  - `session.messages({ after })`가 `{ deny }`를 돌려주면 `{ last: FALLBACK_LAST }`로 다시 읽어 요약을 계속한다(Review Focus 1).
  - 메인으로 돌아온 뒤 `session.messages({ after: 'M1' })`가 행 3개를 돌려주면 `COPY.mainMoved(3)`(`곁가지에 있는 동안 메인이 메시지 3개만큼 진행됐어요. 마지막 지점으로 돌아왔어요`) 알림이 뜬다.
  - `onResumed(..., false)`면 붙이지 않고 기록이 `open` 그대로, `메인 세션으로 돌아가지 못했어요` 알림이 뜬다.
  - 곁가지의 곁가지 `C(parent=B)`에서 `/back`하면 대상은 `B`다(메인 `A`가 아니다).
  - 기록 없는 세션이지만 세션 기록 첫 부분에 `forkedFrom: { sessionId: 'S1', messageUuid: 'M1' }`이 있으면 그 값을 부모로 같은 흐름을 탄다(세션 기록은 `$.session.info().transcriptPath`를 `$.fs.read`로 가져온다).
- [ ] **Step 4: 실패 확인**: `claude plugin test ...` → `back.test.tsx` 실패
- [ ] **Step 5: `register.tsx`에 `back` 명령(immediate 아님)과 `onResumed` 연결.** 질문은 `$.ui.ask(<요약 + 바뀐 파일 + 메인에 가져갈까요?>, { header: '곁가지 요약', options: ['가져가기', '고쳐서 가져가기', '안 가져가기'] })`. 요약 모델은 `options.summaryModel`.
- [ ] **Step 6: 통과 확인**: `claude plugin test ...` → 통과, `claude plugin validate ...` → 통과
- [ ] **Step 7: 커밋 명령어 제시**
  ```bash
  git add plugins/claude-code/hooks/lib/summary.ts plugins/claude-code/hooks/register.tsx plugins/claude-code/hooks/summary.test.ts plugins/claude-code/hooks/back.test.tsx && git commit -m "feat: /back 요약 가져가기와 메인 복귀"
  ```

### Task 5: `/tree` 옆 칸

**Files:**
- Create: `plugins/claude-code/hooks/ui/tree.tsx`
- Modify: `plugins/claude-code/hooks/register.tsx`
- Test: `plugins/claude-code/hooks/tree.test.tsx`

**Interfaces:**
- Consumes: `treeOf`, `loadRecords`, `enqueue`, `refreshView`, `COPY`
- Produces: `renderTree($, e, tree: TreeNode, currentSessionId: string)`; 옆 칸 id는 `PANE_ID = 'detour-tree'`.

- [ ] **Step 1: 실패하는 시험 작성** (`tree.test.tsx`, `terminal`과 `desktop`에서 같은 본문 반복)
  - `/tree` 실행 시 `ui.open`이 `{ id: 'detour-tree', title: '가지' }`로 불리고 결과가 `isTextDisplayOnly: true`.
  - 기록 `B(parent=A)`, `C(parent=B)`에서 지금 세션이 `C`면 옆 칸에 `메인`, `B 제목`, `C 제목`이 들여쓰기 순서대로 보이고 `C` 줄에만 `지금` 표시가 있다. 돌아온 가지 줄에는 `돌아옴` 표시가 있다.
  - `B` 줄 버튼을 누르면 대기열에 `{ kind: 'resume', targetSessionId: 'B' }`가 들어가고 옆 칸이 닫힌다(`ui.close`). 지금 세션 줄을 누르면 아무것도 하지 않는다.
  - `B`가 `returned`였다면 `onResumed(..., true)` 뒤 `B`의 `status`가 `open`으로 바뀌고 입력창 위 한 줄에 `곁가지: <B 제목> | ...`이 다시 보인다.
- [ ] **Step 2: 실패 확인 후 구현, 통과 확인**: `claude plugin test ...`, `claude plugin validate ...`
- [ ] **Step 3: 커밋 명령어 제시**
  ```bash
  git add plugins/claude-code/hooks/ui/tree.tsx plugins/claude-code/hooks/register.tsx plugins/claude-code/hooks/tree.test.tsx && git commit -m "feat: /tree 옆 칸"
  ```

### Task 6: 실제 왕복 시험과 README

**Files:**
- Create: `scripts/e2e.py`, `README.md`, `README.ko.md`
- Test: `scripts/e2e.py` 자체가 시험

**Interfaces:**
- Consumes: 완성된 플러그인 폴더

- [ ] **Step 1: `scripts/e2e.py` 작성.** 시험용 플러그인 때 쓴 방식을 따른다.
  - `pty.fork`로 `claude --plugin-dir <플러그인 폴더> --model haiku`를 50행 200열로 띄운다. 자식 프로세스에서 `CLAUDE`, `AI_AGENT`로 시작하는 환경 변수를 모두 지운다(지우지 않으면 세션 기록이 저장되지 않는다).
  - 작업 폴더는 `$HOME/.cache/detour-e2e/<시각>`에 새로 생성한다. `/tmp` 아래는 쓰지 않는다.
  - 처음 뜨는 폴더 신뢰 창은 기본 선택이 `No, exit`이므로 아래 화살표(`\x1b[B`) 뒤 Enter를 보낸다.
  - 글자를 보낸 뒤 0.6초 쉬고 Enter를 따로 보낸다.
  - 순서: `Reply with exactly: OK` → `/side Reply with exactly: SIDE` → 25초 대기 → `/back` → 질문 창에서 Enter(첫 선택지 `가져가기`) → 20초 대기 → `Is there a note from a plugin about a side branch? Quote it in one line.` → `/exit`.
  - 판정(세션 기록 jsonl을 읽어서): 메인 세션의 사람 메시지에 `SIDE`가 없다. 메인에 플러그인 메모 행이 하나 있고 `[곁가지 "`로 시작한다. 마지막 답에 그 메모 내용이 인용돼 있다. 곁가지 세션 기록에 `forkedFrom.sessionId == 메인 ID`.
  - 끝나면 작업 폴더와 `~/.claude/projects` 아래 그 폴더의 세션 기록을 지운다. 실패해도 지운다(`try/finally`).
  - 통과면 `E2E PASS`, 실패면 이유와 함께 `E2E FAIL: ...`을 출력하고 종료 코드 1.
- [ ] **Step 2: 한 번 실행**: `python3 -I scripts/e2e.py` → `E2E PASS`. 모델 호출이 몇 번 드는 시험이라 한 번만 돌리고, 실패하면 원인을 고친 뒤 다시 한 번 돌린다.
- [ ] **Step 3: README 작성.** `README.md`(영어)와 `README.ko.md`(한국어)에 같은 내용: 무엇을 하는지 두 줄, 설치(`claude --plugin-dir /path/to/plugins/claude-code`로 써 보기, 배포 방법은 아직 정하지 않음), 명령 세 개와 예시, 확인한 Claude Code 버전 2.1.330, 알려진 제약(곁가지에서 바뀐 파일은 되돌리지 않음, 자동 옆 칸은 144칸 이상, 요약마다 모델 호출 한 번).
- [ ] **Step 4: 커밋 명령어 제시**
  ```bash
  git add scripts/e2e.py README.md README.ko.md && git commit -m "test: 실제 왕복 시험과 README"
  ```
