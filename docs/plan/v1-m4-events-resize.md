# v1-M4：事件与尺寸（on/output/exit/resize）

## Goal

提供事件接口与终端尺寸调整能力，完成对外 API 契约的关键补齐。

## PRD Trace

- REQ-012, REQ-011

## Scope

做：
- `on('output'|'exit', listener)`：事件可订阅，支持链式返回 `this`
- `resize(sessionId, cols, rows)`：对存在 session 调用 `pty.resize`

不做：
- ANSI 转义序列解析/清洗（保持原样）

## Acceptance（硬 DoD）

1) `output` 事件能收到与 `getOutput()` 一致来源的片段（测试只断言收到非空数据与正确 sessionId）。  
2) 进程退出时触发一次 `exit` 事件（测试断言次数与 exitCode 合理）。  
3) `resize(sessionId, cols, rows)` 可调用且不会破坏后续输出捕获。  
4) `npm test` 全绿。

## Files（预期改动）

- `src/PTYManager.ts`
- `test/events-resize.test.ts`

## Steps（Tashan Loop）

1) TDD Red：为事件与 resize 写失败测试  
2) Run to Red：`npm test`  
3) TDD Green：实现  
4) Run to Green：`npm test`  
5) Refactor（仍绿）

