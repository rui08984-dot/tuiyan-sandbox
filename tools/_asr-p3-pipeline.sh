#!/bin/bash
# 第 9 局（av25007483 p3，1:39:46）W1 ASR 流水线 · 主会话自营（三棒死于模型服务瞬断后收回）
# 流程照第 8 局 W1 先例：ffmpeg 600s/16k/mono 分段 → asr_worker --dump-raw → merge → sources copy
set -u
AUD="E:/music player/素材库/对标视频-音频/av25007483p3.m4a"
SEGDIR="E:/music player/素材库/对标视频-转写/PandaKill/_p3_segments"
TXDIR="E:/music player/素材库/对标视频-转写/PandaKill"
PY="D:/ailove/my-neuro/my-neuro/env/python.exe"
ASRW="D:/codex/.audio-tools/asr_worker.py"
MERGE="E:/music player/tools/merge_asr_raw.py"
OUT="$TXDIR/PandaKill_av25007483p3_99min_文稿.txt"
SRC="E:/music player/docs/sandbox/p0-replay/sources/asr-pandakill-s1e6p3-full-transcript.txt"

echo "=== [$(date '+%T')] 分段 ==="
mkdir -p "$SEGDIR"
ffmpeg -y -i "$AUD" -f segment -segment_time 600 -ac 1 -ar 16000 "$SEGDIR/seg_%02d.wav" 2>>"$TXDIR/_p3_ffmpeg.err"
ls "$SEGDIR" || { echo "FATAL 分段失败"; exit 1; }

echo "=== [$(date '+%T')] ASR（CPU，~15-30 分钟）==="
"$PY" "$ASRW" --input "$SEGDIR"/seg_*.wav --output-dir "$TXDIR" --dump-raw --model paraformer
RC=$?
echo "asr_worker exit=$RC"
if [ $RC -ne 0 ]; then echo "FATAL ASR 失败"; exit 1; fi

echo "=== [$(date '+%T')] 合并 ==="
JSONS=$(ls "$TXDIR"/av25007483p3_seg_*_raw.json 2>/dev/null | sort)
[ -z "$JSONS" ] && { echo "FATAL raw json 缺失"; exit 1; }
"$PY" "$MERGE" "$OUT" $JSONS || exit 1

echo "=== [$(date '+%T')] sources copy + 清理分段 wav ==="
cp "$OUT" "$SRC"
rm -rf "$SEGDIR"
echo "=== [$(date '+%T')] DONE ==="
ls -la "$OUT" "$SRC"
