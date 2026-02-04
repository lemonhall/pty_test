# v1 计划索引（PTY 进程管理器）

**版本**：v1  
**日期**：2026-02-04  
**PRD**：`docs/prd/pty-process-manager.md`  
**输入参考**：`spec.md`（历史草稿，已拆分成 PRD + v1 计划）

## 1. 本轮目标（v1 Goal）

交付一个可发布的 Node.js 包（含 TS 类型），实现核心 PTY session 管理能力，并提供可重复运行的自动化测试（优先覆盖 P0 用例）。

## 2. 里程碑（Milestones）

| 里程碑 | 范围 | DoD（Definition of Done） | 验证命令 | 状态 |
|---|---|---|---|---|
| M1 | 核心会话与输出 | `spawn/getOutput/getStatus` 可用；输出缓冲上限生效 | `npm test` | done |
| M2 | 输入与终止 | `write/kill` 可用；退出路径稳定；错误码明确 | `npm test` | done |
| M3 | 会话管理 | `listSessions/cleanup/sessionTTL/destroy` 可用 | `npm test` | done |
| M4 | 事件与尺寸 | `on('output'|'exit')/resize` 可用（含最小测试） | `npm test` | done |

## 3. 计划文档索引

- `docs/plan/v1-m1-core.md`
- `docs/plan/v1-m2-interaction.md`
- `docs/plan/v1-m3-session-management.md`
- `docs/plan/v1-m4-events-resize.md`

## 4. 追溯矩阵（Traceability）

| Req ID | 计划条目 | 自动化验证（tests/commands） | 证据 |
|---|---|---|---|
| REQ-001 | v1-m1 | `npm test`（spawn 基础） | `npm test` 输出 |
| REQ-002 | v1-m1 | `npm test`（spawn opts） | `npm test` 输出 |
| REQ-003 | v1-m1 / v1-m4 | `npm test`（output 捕获/事件） | `npm test` 输出 |
| REQ-004 | v1-m1 | `npm test`（SessionNotFound） | `npm test` 输出 |
| REQ-005 | v1-m1 | `npm test`（buffer cap） | `npm test` 输出 |
| REQ-006 | v1-m2 | `npm test`（write/ctrl+c） | `npm test` 输出 |
| REQ-007 | v1-m1 / v1-m2 | `npm test`（status exitCode/endTime） | `npm test` 输出 |
| REQ-008 | v1-m2 | `npm test`（kill SIGTERM/SIGINT） | `npm test` 输出 |
| REQ-009 | v1-m3 | `npm test`（listSessions） | `npm test` 输出 |
| REQ-010 | v1-m3 | `npm test`（cleanup/ttl） | `npm test` 输出 |
| REQ-011 | v1-m4 | `npm test`（resize API） | `npm test` 输出 |
| REQ-012 | v1-m4 | `npm test`（events） | `npm test` 输出 |
| REQ-013 | v1-m3 | `npm test`（destroy） | `npm test` 输出 |

## 5. 跨平台验证说明（Windows / WSL2）

- 本仓库自动化测试默认在 Linux/WSL2 运行。
- Windows 10/11 必验：至少手动执行一轮 `npm test`，并额外验证 `spawn('cmd.exe', { args: ['/c', 'dir'] })`。
- 集成测试（真实 PTY）：默认跳过，可通过 `RUN_PTY_INTEGRATION=1 npm test` 启用。

## 6. 差异与已知风险（v1）

- `node-pty` 在 Windows 的安装/编译可能失败：需要在 README 中给出常见排障（Python/MSVC/预编译）路径。
- `SIGINT/SIGTERM` 在不同平台行为存在差异：测试应以“最终结束 + 状态一致性”作为判定。
