#!/bin/bash
# 等渲染队列全部空闲（无 submitted/pending）后自动渲染 EP01-B —— v2（0904 对齐交接最新命令）
# v1→v2 变更：wav→mp3（delayRender 超时坑）/ 补 headless-shell 浏览器参数（Page crashed 坑）/
#   补 PATH export（裸 node 坑）/ ASCII 临时名+mv 改中文名（execSync 中文坑）/ DONE 旗标收尾
P=C:/Users/crx/AppData/Local/Programs/Python/Python313/python.exe
while true; do
  BUSY=$($P D:/hot-step/queue_manager.py status 2>/dev/null | grep -cE "submitted|pending")
  if [ "$BUSY" = "0" ]; then echo "队列空闲，开始渲染 EP01-B"; break; fi
  sleep 300
done
export PATH="/d/agent1super/node:$PATH"
cd C:/Users/crx/.agents/skills/acestep-simplemv/scripts && { node render.mjs \
  --audio "E:/music player/assets/ep01/playlist.mp3" \
  --lyrics-json "E:/music player/assets/ep01/tracks.json" \
  --background "E:/music player/assets/covers/candidates/e_暮色城市人物/photo_02_17426256.jpg" \
  --title "MIDNIGHT RADIO" --subtitle "EP.01 — Blue Hour" \
  --credit "AI-generated music · original composition" \
  --chrome-mode headless-shell \
  --browser "C:/Users/crx/.agents/skills/acestep-simplemv/scripts/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe" \
  --output "E:/music player/out/EP01B_render_tmp.mp4" \
  > "E:/music player/assets/ep01/render_b.log" 2>&1 \
  && mv "E:/music player/out/EP01B_render_tmp.mp4" "E:/music player/out/EP01B_目录高亮版.mp4"; \
  echo "渲染结束 exit=$?" > "E:/music player/assets/ep01/EP01B_DONE.flag"; }
