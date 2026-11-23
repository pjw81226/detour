# 한국어 README GIF. 저장소 루트에서: vhs scripts/demo/demo.ko.tape
# 처음 보는 폴더면 신뢰 확인 창이 뜨고, 숨긴 구간에서 아래 화살표와 Enter로 넘긴다.
Output "docs/demo.ko.gif"
Set Shell "zsh"
Set FontSize 15
Set FontFamily "D2Coding"
Set Width 1300
Set Height 780
Set Padding 18
Set Framerate 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 28ms
Set WindowBar Colorful
Set PlaybackSpeed 1.2

Hide
Type "scripts/demo/demo.sh"
Enter
Sleep 12s
Down
Enter
Sleep 10s
Show

# 나무를 먼저 열어 둔다: 처음엔 main 하나뿐
Type "/tree"
Sleep 150ms
Enter
Sleep 800ms

Type "src/orders.js 한 줄로 설명해 줘"
Sleep 150ms
Enter
Sleep 4s

# 첫 fork: 나무에 새 줄이 생기고 here가 옮겨 간다
Type "/side 필터가 왜 두 번 돌지?"
Sleep 150ms
Enter
Sleep 6s

Type "/back"
Sleep 150ms
Enter
Sleep 2s

# 두 번째 fork: main 아래에 하나 더
Type "/side 캐시 키는 안전해?"
Sleep 150ms
Enter
Sleep 6s

Type "/back"
Sleep 150ms
Enter
Sleep 2s

# main은 fork에서 한 질문을 모른다
Type "방금 내가 뭐 물어봤지? 한 줄로"
Sleep 150ms
Enter
Sleep 4500ms
Sleep 1500ms
