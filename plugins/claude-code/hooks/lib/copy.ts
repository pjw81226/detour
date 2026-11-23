// 화면에 보이는 문구는 전부 여기에 둔다
export const COPY = {
  sideDescription: 'Fork the conversation here and ask a side question',
  backDescription: 'Go back to where you forked',
  treeDescription: 'Show the forks of this session',
  sideHint: '[question]',

  waiting: 'Will fork when Claude finishes',
  sideBand: (title: string) => `fork: ${title} | /back to return`,
  sideQueued: (title: string) => `Forking: ${title}`,
  alreadyPending: 'Already waiting to fork',
  branchFailed: "Couldn't fork",
  sideAfterStop: 'Plugin input is paused after Esc. Press Enter to fork',
  questionKept: 'Your question is in the prompt box. Press Enter to send it',
  busy: 'Already waiting to switch sessions',

  noParent: 'Nothing to go back to',
  filesNote: 'Files changed in the fork stay changed',
  backQueued: 'Going back',
  mainMoved: (n: number) => `The original session moved on by ${n} messages while you were away. You are at its latest point`,
  resumeFailed: "Couldn't go back to the original session",
  manualTitle: 'manual fork',

  rootTitle: 'main',
  rename: 'rename',
  renameLabel: 'New name',
  save: 'Save',
  treeTitle: 'forks',
  treeNow: 'here',
  treeReturned: 'returned',
  treeOpened: 'Pick a fork in the pane to switch to it',
  treeNotPlaced: "Couldn't open the pane. Widen the terminal, or switch with /resume <session id>",
} as const
