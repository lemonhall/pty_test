# Examples

先编译再运行：

```bash
npm run build
```

## 1) 60 秒断断续续输出 + 捕获

```bash
npm run example:stream
```

这个例子会启动一个子进程，持续约 60 秒随机间隔输出几行日志，然后退出；`PTYManager` 会通过 `output` 事件实时打印，并在退出后用 `getOutput()` 拿到完整缓存。

## 1.1) 按 offset/limit 读取输出（更像 “process log”）

```bash
npm run example:log
```

这个例子用 `readOutput({ offset, limit })` 按“游标”增量读取输出，适合做 `process action:log` 那种接口。

## 3) 用 PTY 启动 Codex 并持续捕获输出（HTML 小游戏）

```bash
npm run example:codex-game
```

这个例子会在临时目录创建一个新的 git repo，然后用 `PTYManager` 启动 `codex exec --full-auto` 生成一个 `index.html` 小游戏，并用 `log(offset/limit)` 持续增量打印输出。

输出里有两种 ID：
- `ptySessionId=...`：PTY/进程会话 ID（用于 `log/poll/write/kill` 这种“过程控制”）
- `codexThreadId=...`：Codex 自己的对话线程 ID（用于 `codex exec resume <id>`，只有你想继续同一上下文时才需要）

## 2) 启动 vim，然后按键退出（ESC + :q! + Enter）

```bash
npm run example:vim
```

说明：
- 该例子会生成并打开一个临时文件（并显式设置 vim 的 `cwd` 为仓库根目录），避免“到底打开了哪个文件”的歧义，也避免污染 git working tree。
- 全屏 TUI 程序（vim）输出包含大量 ANSI 控制序列；`getOutput()` 会得到“原始终端输出”，这是正常的。
- 如遇 `SPAWN_FAILED`（例如 WSL/容器 PTY 权限/挂载问题），需要先修复 PTY 环境或换到本机终端运行。
