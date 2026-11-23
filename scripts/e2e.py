#!/usr/bin/env python3
"""detour 플러그인 실제 왕복 시험.

별도 Claude Code를 가상 터미널로 띄워 /side -> 곁가지 질문 -> /back -> 가져가기를 실제로 돌리고,
세션 기록(jsonl)으로 판정한다. 모델 호출이 몇 번 들어가므로 필요할 때 한 번씩만 돌린다.

    python3 -I scripts/e2e.py

주의
- Claude Code 안에서 띄우면 CLAUDE_CODE_CHILD_SESSION 같은 환경 변수가 넘어가 세션 기록이 저장되지 않는다.
  그래서 CLAUDE, AI_AGENT로 시작하는 환경 변수를 지우고 띄운다.
- 처음 보는 폴더면 신뢰 확인 창이 뜨고 기본 선택이 "No, exit"다. 아래 화살표 뒤 Enter를 보낸다.
"""
import glob
import json
import os
import pty
import re
import select
import shutil
import struct
import sys
import termios
import fcntl
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(ROOT, "plugins", "claude-code")
STAMP = time.strftime("%Y%m%d-%H%M%S")
WORK = os.path.join(os.path.expanduser("~"), ".cache", "detour-e2e", STAMP)
PROJECTS = os.path.join(os.path.expanduser("~"), ".claude", "projects")
STORES = os.path.join(os.path.expanduser("~"), ".claude", "plugins", "store", "detour_*.json")
SESSION_ENV = os.path.join(os.path.expanduser("~"), ".claude", "session-env")
LONG_PROMPT = "Write the integers from 1 to 1500 separated by single spaces, and nothing else."
BACK_QUESTION = "What was the most recent message I sent you before this one? Quote it exactly."
ANSI = re.compile(r"\x1b\[[0-9;?<>=]*[A-Za-z~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78DME]")


class Terminal:
    def __init__(self, argv, cwd):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd)
            for key in list(os.environ):
                if key.startswith(("CLAUDE", "AI_AGENT")):
                    del os.environ[key]
            os.execvp(argv[0], argv)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 200, 0, 0))
        self.raw = bytearray()
        self.stop = False
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while not self.stop:
            ready, _, _ = select.select([self.fd], [], [], 0.5)
            if not ready:
                continue
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                return
            if not data:
                return
            self.raw.extend(data)

    def screen(self, since=0):
        return ANSI.sub(" ", self.raw[since:].decode("utf-8", "replace"))

    def mark(self):
        return len(self.raw)

    def wait_for(self, pattern, timeout, since=0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if re.search(pattern, self.screen(since)):
                return True
            time.sleep(0.5)
        return False

    def keys(self, data):
        os.write(self.fd, data)

    def say(self, text):
        os.write(self.fd, text.encode())
        time.sleep(0.6)
        os.write(self.fd, b"\r")

    def close(self):
        self.stop = True
        try:
            os.kill(self.pid, 9)
        except OSError:
            pass


def rows(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out


def text_of(row):
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text", "") for b in content if isinstance(b, dict))
    return ""


def assistant_texts(path):
    return [text_of(r).strip() for r in rows(path) if r.get("type") == "assistant" and text_of(r).strip()]


def answer_after(path, question):
    # question을 보낸 사람 메시지 바로 뒤의 첫 Claude 답
    seen = False
    for r in rows(path):
        if r.get("type") == "user" and question in text_of(r):
            seen = True
        elif seen and r.get("type") == "assistant" and text_of(r).strip():
            return text_of(r).strip()
    return ""


def forked_from(path):
    for r in rows(path):
        if isinstance(r.get("forkedFrom"), dict):
            return r["forkedFrom"].get("sessionId")
    return None


def stored_records():
    out = {}
    for path in glob.glob(STORES):
        try:
            data = json.load(open(path, encoding="utf-8"))
        except ValueError:
            continue
        for key, value in data.items():
            if key.startswith("rec:") and isinstance(value, dict):
                out[value.get("id")] = value
    return out


def check_fork_point(main, side, records):
    # 작업 중 /side: 플러그인이 남긴 갈라진 지점이 작업이 끝난 뒤의 메시지여야 한다(작업 도중 메시지면 틀림)
    side_id = os.path.basename(side)[:-6]
    rec = records.get(side_id)
    if rec is None:
        return f"곁가지 {side_id} 기록이 플러그인 저장소에 없다"
    copied = [r.get("uuid") for r in rows(side) if isinstance(r.get("forkedFrom"), dict)]
    parent = rec.get("parentMessageUuid")
    if parent not in copied:
        return f"갈라진 지점 {parent}가 곁가지에 복사된 메시지가 아니다"
    main_rows = rows(main)
    uuids = [r.get("uuid") for r in main_rows]
    prompt_at = next((i for i, r in enumerate(main_rows) if r.get("type") == "user" and LONG_PROMPT in text_of(r)), None)
    reply_at = next((i for i, r in enumerate(main_rows) if prompt_at is not None and i > prompt_at and r.get("type") == "assistant" and text_of(r).strip()), None)
    if prompt_at is None or reply_at is None or parent not in uuids:
        return "작업 중 /side 판정에 필요한 메인 메시지를 찾지 못했다"
    if uuids.index(parent) < reply_at:
        return "갈라진 지점이 작업이 끝나기 전 메시지다(/side를 친 순간을 썼다)"
    return None


def judge(project_dir, only_wait=False):
    files = glob.glob(os.path.join(project_dir, "*.jsonl"))
    if not files:
        return "세션 기록이 하나도 없다"
    roots = [f for f in files if forked_from(f) is None]
    if len(roots) != 1:
        return f"메인 세션이 하나가 아니다: {len(roots)}개"
    main = roots[0]
    main_id = os.path.basename(main)[:-6]
    sides = [f for f in files if forked_from(f) == main_id]
    if not sides:
        return "메인에서 갈라진 곁가지 세션이 없다"
    if only_wait:
        side3 = [s for s in sides if "SIDE3" in assistant_texts(s)]
        return check_fork_point(main, side3[0], stored_records()) if side3 else "곁가지(SIDE3)가 생기지 않았다"
    if not any(t == "SIDE" for s in sides for t in assistant_texts(s)):
        return "곁가지에서 SIDE 답이 없다"
    if any(t == "SIDE" for t in assistant_texts(main)):
        return "메인에 곁가지 답(SIDE)이 섞였다"
    # /back은 요약을 가져가지 않는다. 메인은 곁가지를 모르고, 갈라지기 전 메시지를 기억해야 한다
    if "[곁가지" in open(main, encoding="utf-8").read():
        return "메인에 곁가지 요약이 붙었다(요약은 가져가지 않아야 한다)"
    answer = answer_after(main, BACK_QUESTION)
    if "Reply with exactly: OK" not in answer:
        return f"/back 뒤 메인이 갈라지기 전 메시지를 기억하지 못했다: {answer[:160]!r}"
    side3 = [s for s in sides if "SIDE3" in assistant_texts(s)]
    if not side3:
        return "작업 중 /side(기다리기) 경우: 곁가지(SIDE3)가 생기지 않았다"
    problem = check_fork_point(main, side3[0], stored_records())
    if problem:
        return problem
    if not any(t == "SIDE2" for s in sides for t in assistant_texts(s)):
        return "작업 중 /side 뒤 Esc 경우: 곁가지(SIDE2)가 생기지 않았다"
    return None


def cleanup(project_dir):
    ids = {os.path.basename(f)[:-6] for f in glob.glob(os.path.join(project_dir, "*.jsonl"))}
    # 시험 세션의 곁가지 기록만 플러그인 저장소에서 지운다
    for path in glob.glob(STORES):
        try:
            data = json.load(open(path, encoding="utf-8"))
        except ValueError:
            continue
        kept = {k: v for k, v in data.items() if not (k.startswith(("rec:", "note:")) and (v or {}).get("id", k[5:]) in ids)}
        if len(kept) != len(data):
            # 중간에 끊겨도 저장소 파일이 깨지지 않게 임시 파일에 쓴 뒤 바꾼다
            with open(f"{path}.tmp", "w", encoding="utf-8") as f:
                json.dump(kept, f)
            os.replace(f"{path}.tmp", path)
    for session_id in ids:
        shutil.rmtree(os.path.join(SESSION_ENV, session_id), ignore_errors=True)
    shutil.rmtree(project_dir, ignore_errors=True)
    shutil.rmtree(WORK, ignore_errors=True)


def keep_artifacts(project_dir, debug_file):
    # 실패하면 지우기 전에 세션 기록, 플러그인 기록, 디버그 로그를 남긴다
    dest = os.path.join(ROOT, ".superpowers", "e2e-artifacts", STAMP)
    os.makedirs(dest, exist_ok=True)
    for f in glob.glob(os.path.join(project_dir, "*.jsonl")):
        shutil.copy(f, dest)
    with open(os.path.join(dest, "records.json"), "w", encoding="utf-8") as f:
        json.dump(stored_records(), f, ensure_ascii=False, indent=2)
    if os.path.exists(debug_file):
        with open(debug_file, encoding="utf-8", errors="replace") as src, open(os.path.join(dest, "debug.txt"), "w", encoding="utf-8") as out:
            out.writelines(line for line in src if "detour" in line)
    return dest


def start(term):
    if term.wait_for(r"trust this folder", 30):
        term.keys(b"\x1b[B")
        time.sleep(0.5)
        term.keys(b"\r")
    time.sleep(12)
    term.say("Reply with exactly: OK")
    time.sleep(25)


def back(term):
    # /back은 묻지 않고 바로 돌아간다
    term.say("/back")
    time.sleep(15)


def basic_scenario(term):
    # /side로 가르고, 곁가지에서 답하고, /back으로 돌아와 메인이 곁가지를 모르는지 본다
    term.say("/side Reply with exactly: SIDE")
    time.sleep(35)
    back(term)
    term.say(BACK_QUESTION)
    time.sleep(30)


def wait_scenario(term):
    # 작업 중 /side(기다리기): 작업이 끝난 뒤에 갈라지고, 갈라진 지점은 끝난 뒤의 마지막 메시지
    at = term.mark()
    term.say(LONG_PROMPT)
    time.sleep(4)
    term.say("/side Reply with exactly: SIDE3")
    if not term.wait_for(r"작업이 끝나면 곁가지로 가요", 15, at):
        raise RuntimeError("작업 중 /side(기다리기): 기다린다는 표시가 뜨지 않았다")
    time.sleep(45)
    back(term)
    term.say("Reply with exactly: BACK")
    time.sleep(20)


def esc_scenario(term):
    # 작업 중 /side, 그리고 Esc: 가르기가 사라지지 않고 멈춘 뒤에 갈라져야 한다
    at = term.mark()
    term.say("Write the integers from 1 to 3000 separated by single spaces, and nothing else.")
    time.sleep(5)
    term.say("/side Reply with exactly: SIDE2")
    if not term.wait_for(r"작업이 끝나면 곁가지로 가요", 15, at):
        raise RuntimeError("작업 중 /side 뒤 기다린다는 표시가 뜨지 않았다(작업이 너무 빨리 끝났을 수 있다)")
    term.keys(b"\x1b")
    # 플러그인 입력은 사용자가 다시 입력할 때까지 거부된다. 5초 안에 풀리지 않으면 입력창에 /side가 다시 채워진다
    if term.wait_for(r"Enter를 누르면 곁가지로 가요", 15, at):
        print("Esc 뒤: 입력창에 다시 채워진 /side를 Enter로 보냄", flush=True)
        time.sleep(1)
        term.keys(b"\r")
    else:
        print("Esc 뒤: 다시 시도만으로 갈라짐", flush=True)
    time.sleep(35)


def finish(project_dir, debug_file, screen, failure):
    # 화면 저장이나 기록 보존이 실패해도 정리는 반드시 한다
    try:
        os.makedirs(os.path.join(ROOT, ".superpowers"), exist_ok=True)
        with open(os.path.join(ROOT, ".superpowers", "e2e-last-screen.txt"), "w", encoding="utf-8") as f:
            f.write(screen[-20000:])
    except OSError as err:
        print(f"화면 저장 실패: {err}")
    if failure:
        try:
            print(f"기록 보존: {keep_artifacts(project_dir, debug_file)}")
        except Exception as err:
            print(f"기록 보존 실패: {err}")
    cleanup(project_dir)
    return failure


def main():
    only_wait = "--only-wait" in sys.argv
    os.makedirs(WORK)
    project_dir = os.path.join(PROJECTS, re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(WORK)))
    debug_file = os.path.join(WORK, "debug.txt")
    term = None
    failure = None
    interrupted = None
    try:
        term = Terminal(["claude", "--plugin-dir", PLUGIN, "--model", "haiku", "--debug-file", debug_file], WORK)
        start(term)
        if not only_wait:
            basic_scenario(term)
        wait_scenario(term)
        if not only_wait:
            esc_scenario(term)
        term.say("/exit")
        time.sleep(15)
    except Exception as err:
        failure = str(err)
    except BaseException as err:
        # Ctrl+C도 정리를 거친 뒤 다시 던진다
        interrupted = err
        failure = "중단됨"
    finally:
        if term is not None:
            term.close()
    try:
        if failure is None:
            failure = judge(project_dir, only_wait)
    finally:
        failure = finish(project_dir, debug_file, term.screen() if term is not None else "", failure)
    if interrupted is not None:
        raise interrupted
    if failure:
        print(f"E2E FAIL: {failure}")
        sys.exit(1)
    print("E2E PASS")


if __name__ == "__main__":
    main()
