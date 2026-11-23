# detour

Claude Code 대화에서 잠깐 옆길로 빠져 곁가지 질문을 조사하고, 갈라졌던 지점으로 그대로 돌아와요. 곁가지에서 나눈 대화는 메인 대화에 섞이지 않아요.

> English: [README.md](README.md)

## 설치

Claude Code 입력창에서:

```
/plugin install detour --marketplace pjw81226/detour
```

마켓플레이스를 추가할지 물으면 `y`, 그다음 설치 범위를 고르세요. 셸에서는 `claude plugin install detour --marketplace pjw81226/detour`예요.

내려받은 폴더로 바로 써 보려면 `claude --plugin-dir /path/to/detour/plugins/claude-code`. Claude Code 2.1.330에서 확인했어요.

## 사용법

1. `/side 이 필터는 왜 두 번 돌지?`
   지금 지점에서 대화를 가르고, 곁가지에서 그 질문을 보내요. Claude가 일하는 중이면 작업이 끝날 때까지 기다렸다가 갈라요.
2. 곁가지에서 조사해요. 곁가지도 온전한 세션이라 도구를 전부 쓸 수 있어요.
3. `/back`
   메인 세션의 갈라졌던 지점으로 바로 돌아와요. 곁가지 내용은 가져오지 않아요. 알아낸 것 중 필요한 게 있으면 메인에서 Claude에게 직접 말하세요.

`/tree`는 지금 세션의 가지 목록을 보여 줘요. 하나를 고르면 그 세션으로 옮기고, 옆의 `이름 바꾸기`를 누르면 이름을 고칠 수 있어요.

곁가지에 있는 동안 입력창 위에 `곁가지: <제목> | /back 으로 메인에 돌아가기`가 보여요.

## 알아 둘 것

- 대화만 갈라요. 곁가지에서 바꾼 파일은 그대로 남고, 돌아올 때 알림으로 목록을 보여 줘요.
- `/side`가 기다리는 중에 Esc를 누르면, Claude Code가 사용자가 다시 입력할 때까지 플러그인 입력을 받지 않아요. 그래서 입력창에 `/side <질문>`을 다시 넣어 둬요. Enter를 누르세요.
- 기본 `/branch`로 직접 가른 세션에서도 `/back`을 쓸 수 있어요.

## 개발

```bash
claude plugin test plugins/claude-code       # 단위 시험
claude plugin validate plugins/claude-code   # 구조와 API 사용 검사
python3 -I scripts/e2e.py                    # 별도 Claude Code로 실제 왕복 확인(모델 호출 몇 번)
python3 -I scripts/test_e2e.py               # e2e 정리 동작 시험
```

`scripts/e2e.py`는 중간에 끊겨도 시험 폴더, 시험 세션, 플러그인 기록을 지워요. `~/.claude.json`의 시험 폴더 항목과 `~/.claude/history.jsonl`의 시험 줄은 남아요. 떠 있는 Claude Code가 함께 쓰는 파일이라 건드리지 않아요.

## 라이선스

MIT
