#!/bin/sh
# =============================================================================
# p1b 四道闸门 · pre-commit 闸
# =============================================================================
# 干什么：提交前把四道闸门（后端 / 构建 / 前端 / 类型）全跑一遍，
#         任一道红 → 本钩子非 0 退出 → git 拒绝这次提交。
#
# ★纪律三条（本文件必须守住）：
#   1. 【不自动改任何文件】。没有 --fix、没有 --write、没有格式化。
#      红了就只报错退出，改不改由人决定。（唯一的写副作用在「构建」那道，
#       它写 p1b/web/dist/，已由 .gitignore:7 挡在版本库外。）
#   2. 【不碰 p1a-terminal/data/p1a.db】。这里没有任何针对它的写操作。
#   3. 【可绕过】。`git commit --no-verify` 跳过本钩子——这是 git 自带行为，
#      不需要本文件实现。任何绕过都该在提交信息里留痕。
#
# 本文件【默认未启用】。它只是躺在 .git/hooks/pre-commit 里，文件权限是「不可执行」，
# 所以 git 不会执行它。「每次提交多花 20–30 秒」是让提交变慢的行为，该由人拍板。
#   启用：chmod +x .git/hooks/pre-commit        （或 Windows：icacls 放开权限）
#   停用：chmod -x .git/hooks/pre-commit
#   重新安装（覆盖）：cp p1b/gates/pre-commit.sh .git/hooks/pre-commit
#
# ⚠ 零 CI 的边界：.git/hooks/ 不进版本库。换机器 / 新人 clone 之后，
#   本闸门【不会】自动跑。补装命令就是上面那行 cp + chmod。
# =============================================================================

# git 跑钩子时 cwd 是仓库顶层；这里再取一次纯属防御（万一被直接执行）。
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || ROOT=$(cd "$(dirname "$0")/../.." && pwd)

RUNNER="$ROOT/p1b/gates/gates.cjs"

if [ ! -f "$RUNNER" ]; then
  echo "pre-commit: 找不到闸门脚本 $RUNNER" >&2
  echo "  本钩子装错了位置，或 p1b/gates/gates.cjs 没入库。" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "pre-commit: PATH 里找不到 node，无法跑闸门。" >&2
  exit 1
fi

echo "pre-commit: 跑四道闸门（后端 / 构建 / 前端 / 类型）…失败会拦住这次提交。"
echo "pre-commit: 明确要绕过请用  git commit --no-verify"
echo ""

# gates.cjs 自己负责：四道全跑、逐道打印退出码、任一红则整体 exit 1。
# 用 exec 把它的退出码原样交给 git，不做任何吞掉/改写。
exec node "$RUNNER"
