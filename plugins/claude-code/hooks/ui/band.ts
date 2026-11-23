// 입력창 위 한 줄에 무엇을 쓸지 정한다. 그리기는 register.tsx가 한다.
import type { View } from '../../types'
import { COPY } from '../lib/copy'
import { findRecord } from '../lib/records'
import type { SideRecord } from '../lib/records'

export type BandProps = { hasSurvey: boolean; isWorking: boolean }

export function viewFor(records: readonly SideRecord[], sessionId: string): View {
  // sessionId를 함께 두면 세션을 옮길 때마다 값이 바뀌어, 이 값을 읽는 옆 칸이 다시 그려진다
  const rec = findRecord(records, sessionId)
  return rec?.status === 'open' ? { sessionId, sideTitle: rec.title } : { sessionId }
}

export function bandLine(view: View, props: BandProps): string | undefined {
  if (props.hasSurvey) return undefined
  if (view.pendingTitle !== undefined && props.isWorking) return COPY.waiting
  if (view.sideTitle !== undefined) return COPY.sideBand(view.sideTitle)
  return undefined
}
