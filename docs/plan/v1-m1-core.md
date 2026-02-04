# v1-M1：核心会话与输出（spawn/output/status/buffer）

## Goal

实现最小可用的 `PTYManager`：能启动进程、捕获输出、限制输出缓冲、查询状态，并把错误码/异常固化为测试。

## PRD Trace

- REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-007

## Scope

做：
- 建立 Node + TypeScript 包结构（build/test/lint 的最小闭环）
- `PTYManager.spawn/getOutput/getStatus` 的最小实现
- 输出缓冲上限与滚动策略（默认 1MB）

不做：
- `write/kill/cleanup/destroy/resize`（移至后续里程碑）

## Acceptance（硬 DoD）

1) `spawn()` 返回 `sessionId`，且 `getStatus(sessionId).status === 'running'`（对短命令允许很快变为 `exited`，用长运行进程验证）。  
2) 启动持续输出进程时，`getOutput(sessionId)` 在运行中能读取到包含最新输出的字符串。  
3) 输出超过 `maxOutputSize` 后，`getOutput(sessionId).length <= maxOutputSize`，且包含末尾的最新输出片段。  
4) `getOutput/getStatus` 对不存在 session 抛出 `SessionNotFoundError`，且 `error.code === 'SESSION_NOT_FOUND'`。  
5) `npm test` 全绿。

## Files（预期改动）

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `src/PTYManager.ts`
- `src/errors.ts`
- `test/core.test.ts`

## Steps（Tashan Loop）

1) TDD Red：为 `spawn/getOutput/getStatus/buffer cap/SessionNotFound` 写失败测试  
2) Run to Red：`npm test`（应失败）  
3) TDD Green：实现最小行为满足测试  
4) Run to Green：`npm test`（应通过）  
5) Refactor（仍绿）：整理错误类型/输出缓冲实现  

## Risks

- `node-pty` 依赖在本机/CI 环境安装失败：先建立明确的安装失败报错提示与 README 指引。

