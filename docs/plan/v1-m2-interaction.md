# v1-M2：输入与终止（write/kill/exit）

## Goal

让 Session 可交互：支持写入输入（含 Ctrl+C），并能可靠终止进程，状态与事件在退出路径上保持一致。

## PRD Trace

- REQ-006, REQ-008, REQ-007（退出状态补齐）

## Scope

做：
- `write(sessionId, text)`：运行中可写入；已结束返回可识别失败
- `kill(sessionId, signal?)`：支持 `SIGTERM/SIGKILL/SIGINT`
- 退出路径：更新 `endTime/exitCode/status`，触发 `exit` 事件（若已实现事件系统）

不做：
- TTL 自动清理/全量 destroy（移至 M3）

## Acceptance（硬 DoD）

1) 对交互式进程（例如 `node -i` 或 `bash`）写入文本能产生可观测输出（测试中以可控脚本进程为主）。  
2) `kill(sessionId, 'SIGINT')` 可使长运行进程最终结束（允许平台差异），且 `getStatus(sessionId).status !== 'running'`。  
3) 对已结束 session `write` 返回 `{ success:false }` 或抛出 `SessionNotRunningError`（二选一，但要一致并由测试锁定）。  
4) `npm test` 全绿。

## Files（预期改动）

- `src/PTYManager.ts`
- `src/errors.ts`
- `test/interaction.test.ts`

## Steps（Tashan Loop）

1) TDD Red：为 `write/kill/exit status` 写失败测试  
2) Run to Red：`npm test`  
3) TDD Green：实现  
4) Run to Green：`npm test`  
5) Refactor（仍绿）

## Risks

- 不同平台下 `SIGINT/SIGTERM` 行为不完全一致：测试以“最终结束 + 状态字段正确更新”为准。

