# PTY 进程管理器（`pty_test`）

本仓库实现一个轻量级的 PTY Session 管理器（Node.js），用于启动交互式进程、捕获输出、发送输入、查询状态与清理会话。

## Docs

- PRD：`docs/prd/pty-process-manager.md`
- v1 计划与追溯：`docs/plan/v1-index.md`

## Install

```bash
npm install
```

如果遇到 npm cache 权限问题，可改用临时 cache：

```bash
NPM_CONFIG_CACHE=/tmp/npm-cache npm install
```

## Usage

```js
import { PTYManager } from './dist/index.js';

const manager = new PTYManager();
const sessionId = manager.spawn('bash', { args: ['-lc', 'echo hello; sleep 1'] });

manager.on('output', (_id, data) => process.stdout.write(data));

// ... later
console.log(manager.getStatus(sessionId));
console.log(manager.getOutput(sessionId));
```

## Test

```bash
npm test
```

真实 PTY 的集成测试默认跳过，可手动启用：

```bash
RUN_PTY_INTEGRATION=1 npm test
```

## Examples

- `npm run example:stream`：启动一个 60 秒断断续续输出的进程并捕获输出
- `npm run example:log`：按 `offset/limit` 增量读取输出（更像 process log）
- `npm run example:vim`：启动 `vim`，发送 `Esc` + `:q!` + `Enter` 退出，并查看捕获的原始输出
- `npm run example:codex-game`：用 PTY 启动 `codex exec` 生成一个 `index.html` 小游戏，并持续捕获输出

`example:codex-game` 会打印两种 ID：
- `ptySessionId`：本库 `PTYManager` 的 session id（用于过程控制：log/poll/write/kill）
- `codexThreadId`：Codex 的对话线程 id（用于 `codex exec resume`，仅在你要继续同一对话上下文时使用）

如果你更想要类似 SKILL 里 `process action:*` 的风格，可以用 `ProcessManager`（提供 `list/poll/log/write/send-keys/submit/paste/kill/clear/remove`）：
- `npm run example:process-like`
