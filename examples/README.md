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

## 2) 启动 vim，然后按键退出（ESC + :q! + Enter）

```bash
npm run example:vim
```

说明：
- 该例子固定打开 `examples/vim-demo.txt`（并显式设置 vim 的 `cwd` 为仓库根目录），避免“到底打开了哪个 README”的歧义。
- 全屏 TUI 程序（vim）输出包含大量 ANSI 控制序列；`getOutput()` 会得到“原始终端输出”，这是正常的。
- 如遇 `SPAWN_FAILED`（例如 WSL/容器 PTY 权限/挂载问题），需要先修复 PTY 环境或换到本机终端运行。
