#!/bin/zsh
# README GIF 녹화용. scripts/demo/record.mjs가 브라우저 터미널(ttyd) 안에서 이 스크립트를 띄운다.
# 화면에 사용자 이름이 담긴 경로가 나오지 않게 /tmp 아래에 시연 폴더와 플러그인 사본을 둔다.
# 사용자 설정(훅, 상태 표시줄, 다른 플러그인)은 빼고, 부모 Claude Code 세션의 환경 변수도 지우고 띄운다.
root=${0:A:h:h:h}
mkdir -p /tmp/detour-demo/src
cp "$root/scripts/demo/orders.js" /tmp/detour-demo/src/orders.js
rsync -a --delete --exclude .claude-plugin/types --exclude tsconfig.json "$root/plugins/claude-code/" /tmp/detour-plugin/
for k in ${(k)parameters[(I)CLAUDE*]} ${(k)parameters[(I)AI_AGENT*]}; do unset $k; done
cd /tmp/detour-demo
exec claude --setting-sources project --plugin-dir /tmp/detour-plugin --model haiku
