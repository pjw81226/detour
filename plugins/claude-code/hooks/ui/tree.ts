// /tree 옆 칸의 줄을 만든다. 그리기는 register.tsx가 한다.
import { COPY } from '../lib/copy'
import type { TreeNode } from '../lib/records'

export const PANE_ID = 'detour-tree'

export type TreeRow = { key: string; title: string; label: string; isCurrent: boolean }

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function timeOf(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function treeRows(root: TreeNode, currentId: string): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (node: TreeNode, depth: number) => {
    const isCurrent = node.sessionId === currentId
    const parts = [
      `${'  '.repeat(depth)}${depth > 0 ? '└ ' : ''}${node.title}`,
      node.createdAt !== undefined ? timeOf(node.createdAt) : '',
      isCurrent ? `● ${COPY.treeNow}` : '',
    ]
    rows.push({ key: node.sessionId, title: node.title, label: parts.filter(p => p !== '').join(' '), isCurrent })
    for (const child of node.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return rows
}

// 터미널에서 차지하는 칸 수. 한글, 한자, 전각 문자, 이모지는 두 칸이다
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff)
    width += isWide ? 2 : 1
  }
  return width
}

// 낱말 하나를 폭에 맞춰 자른다(띄어쓰기 없이 긴 경우)
function splitByWidth(word: string, width: number): string[] {
  const parts: string[] = []
  let part = ''
  for (const ch of word) {
    if (part !== '' && displayWidth(part + ch) > width) {
      parts.push(part)
      part = ''
    }
    part += ch
  }
  if (part !== '') parts.push(part)
  return parts
}

// 줄 하나를 폭에 맞춰 여러 줄로 나눈다. 다음 줄은 제목이 시작하는 위치(들여쓰기와 └ 뒤)에 맞춘다
export function wrapLabel(label: string, width: number): string[] {
  if (displayWidth(label) <= width) return [label]
  const prefix = /^\s*(?:└ )?/.exec(label)?.[0] ?? ''
  const indent = ' '.repeat(displayWidth(prefix))
  const room = Math.max(1, width - indent.length)
  const lines: string[] = []
  let line = prefix
  let isEmpty = true
  for (const word of label.slice(prefix.length).split(' ').filter(w => w !== '')) {
    const candidate = isEmpty ? line + word : `${line} ${word}`
    if (displayWidth(candidate) <= width) {
      line = candidate
      isEmpty = false
      continue
    }
    if (!isEmpty) lines.push(line)
    const pieces = splitByWidth(word, room)
    for (const piece of pieces.slice(0, -1)) lines.push(indent + piece)
    line = indent + (pieces.at(-1) ?? '')
    isEmpty = false
  }
  if (!isEmpty) lines.push(line)
  return lines
}

