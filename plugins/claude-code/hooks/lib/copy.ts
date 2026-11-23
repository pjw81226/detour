// 화면에 보이는 문구는 전부 여기에 둔다
export const COPY = {
  sideDescription: '지금 지점에서 곁가지를 열어요',
  backDescription: '갈라진 곳으로 돌아가요',
  treeDescription: '가지 나무를 옆 칸에 열어요',
  sideHint: '[질문]',

  waiting: '작업이 끝나면 곁가지로 가요',
  sideBand: (title: string) => `곁가지: ${title} | /back 으로 메인에 돌아가기`,
  sideQueued: (title: string) => `곁가지를 준비해요: ${title}`,
  alreadyPending: '이미 곁가지로 갈 준비 중이에요',
  branchFailed: '곁가지를 열지 못했어요',
  sideAfterStop: 'Esc로 멈춘 뒤라 바로 가르지 못했어요. Enter를 누르면 곁가지로 가요',
  questionKept: '질문을 입력창에 넣어 뒀어요. Enter로 보내세요',
  busy: '이미 다른 이동을 기다리는 중이에요',

  noParent: '돌아갈 곳이 없어요',
  filesNote: '곁가지에서 바뀐 파일은 그대로 남아요',
  backQueued: '메인으로 돌아가요',
  mainMoved: (n: number) => `곁가지에 있는 동안 메인이 메시지 ${n}개만큼 진행됐어요. 마지막 지점으로 돌아왔어요`,
  resumeFailed: '메인 세션으로 돌아가지 못했어요',
  manualTitle: '직접 가른 곁가지',

  rootTitle: '메인',
  rename: '이름 바꾸기',
  renameLabel: '새 이름',
  save: '저장',
  treeTitle: '가지',
  treeNow: '지금',
  treeReturned: '돌아옴',
  treeOpened: '옆 칸에서 가지를 누르면 그 세션으로 옮겨요',
  treeNotPlaced: '옆 칸을 띄우지 못했어요. 터미널 창을 넓히거나 /resume <세션 ID>로 옮기세요',
} as const
