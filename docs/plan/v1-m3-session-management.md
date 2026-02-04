# v1-M3：会话管理（list/cleanup/ttl/destroy）

## Goal

补齐管理器维度功能：列出 session、清理已结束 session、支持 TTL 自动清理，并提供 `destroy()` 终止所有运行中进程。

## PRD Trace

- REQ-009, REQ-010, REQ-013

## Scope

做：
- `listSessions(): SessionStatus[]`
- `cleanup(sessionId?)`：清理指定或全部已结束 session
- `sessionTTL`：已结束 session 超时自动移除（定时器/惰性清理均可，但要可测试）
- `destroy()`：终止所有仍在运行的 session，并清空管理器

不做：
- resize/事件增强（移至 M4）

## Acceptance（硬 DoD）

1) 启动多个 session 后 `listSessions()` 返回包含全部 `sessionId` 的状态条目。  
2) 结束 session 后 `cleanup(sessionId)` 会移除并返回该 id；再次查询应抛 `SessionNotFoundError`。  
3) `sessionTTL` 设置为很小值（如 50ms）时，结束 session 在 TTL 后会被自动清理（测试用例必须可稳定复现）。  
4) `destroy()` 后，所有 session 都不再是 `running` 且 `listSessions().length === 0`。  
5) `npm test` 全绿。

## Files（预期改动）

- `src/PTYManager.ts`
- `test/session-management.test.ts`

## Steps（Tashan Loop）

1) TDD Red：为 `list/cleanup/ttl/destroy` 写失败测试  
2) Run to Red：`npm test`  
3) TDD Green：实现  
4) Run to Green：`npm test`  
5) Refactor（仍绿）

## Risks

- TTL 测试易 flake：优先采用“可注入 clock/now + 可控 tick”的实现，或改成惰性清理并在测试里显式触发。

