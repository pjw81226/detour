// 입력창 위 한 줄과 옆 칸이 읽는 화면 상태
export type View = {
  sessionId?: string
  pendingTitle?: string
  sideTitle?: string
}

declare module 'claude-code' {
  interface PluginState {
    'detour': {
      view: Shaped<View>
      // 메인에서 Claude가 일하는 중인지(핫 리로드에도 남는다)
      busy: Shaped<boolean>
      // 옆 칸에서 이름을 고치는 중인 세션 ID(없으면 빈 문자열)
      editing: Shaped<string>
    }
  }
}
