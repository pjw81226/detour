# README GIF. 저장소 루트에서: vhs scripts/demo/demo.tape
# 처음 보는 폴더면 신뢰 확인 창이 뜨고, 숨긴 구간에서 아래 화살표와 Enter로 넘긴다.
Output "docs/demo.gif"
Set Shell "zsh"
Set FontSize 15
Set Width 1300
Set Height 780
Set Padding 18
Set Framerate 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set WindowBar Colorful
Set PlaybackSpeed 1.4

Hide
Type "scripts/demo/demo.sh"
Enter
Sleep 12s
Down
Enter
Sleep 12s
Show

Sleep 1s
Type "Walk me through src/orders.js in two lines"
Sleep 400ms
Enter
Sleep 14s

Type "/side why does the filter run twice?"
Sleep 700ms
Enter
Sleep 22s

Type "/tree"
Sleep 700ms
Enter
Sleep 5s

Type "/back"
Sleep 700ms
Enter
Sleep 6s

Type "What did I just ask you? One line."
Sleep 400ms
Enter
Sleep 12s
