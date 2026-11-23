// 세션 기록 파일에서 /branch가 남긴 갈라진 지점을 찾는다(비공식 형식).
// $.fs.read는 4 MiB를 넘는 결과를 거부하므로 끝에서부터 나눠 읽는다.
import { parseForkedFrom } from './records'

export type FilePort = {
  size: () => Promise<number>
  read: (offset: number, length: number) => Promise<string>
}

export const CHUNK_BYTES = 1024 * 1024
// 64 MiB까지만 거슬러 읽는다
const MAX_CHUNKS = 64

export async function findForkPoint(
  file: FilePort,
  chunkBytes: number = CHUNK_BYTES,
): Promise<{ sessionId: string; messageUuids: string[] } | undefined> {
  try {
    let end = await file.size()
    // 앞 조각과 이어 붙일, 이번 조각 맨 앞의 잘린 줄
    let carry = ''
    for (let i = 0; i < MAX_CHUNKS && end > 0; i += 1) {
      const start = Math.max(0, end - chunkBytes)
      const text = (await file.read(start, end - start)) + carry
      const cut = start > 0 ? text.indexOf('\n') : -1
      carry = cut >= 0 ? text.slice(0, cut) : start > 0 ? text : ''
      const whole = cut >= 0 ? text.slice(cut + 1) : start > 0 ? '' : text
      const found = parseForkedFrom(whole)
      if (found !== undefined) return found
      end = start
    }
    return carry === '' ? undefined : parseForkedFrom(carry)
  } catch {
    return undefined
  }
}
