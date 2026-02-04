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

