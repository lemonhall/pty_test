# PTY 进程管理器（Node.js）PRD / Spec（OpenSpec）

**项目**：`pty_test`  
**版本**：`0.1.0`（目标）  
**日期**：2026-02-04  
**状态**：Draft（由 `spec.md` 拆分整理）

## 0. 愿景（Vision）

提供一个可嵌入任意 Node.js 工程的“PTY 会话管理器”，用统一的 Session 抽象来管理多个交互式命令行进程：可启动、实时捕获输出、动态发送输入、随时查询状态、并能可靠终止与清理。

## 1. 背景（Background）

在研究 OpenClaw 的 `exec/process` 工具组时，参考其异步进程管理模式：通过 PTY 启动进程，流式输出、可写入输入、可查询状态，并支持多并发 session。

## 2. 范围（Scope）

本项目交付一个 Node.js 模块（非服务、非 UI），对外暴露一个 `PTYManager` 类：

- 支持并发管理多个 PTY session（以 `sessionId` 唯一标识）
- 通过事件与查询 API 提供输出与状态能力

## 3. 非目标（Non-goals）

- 不提供 Web UI / REST API
- 不实现 IPC（进程间通信）协议层
- 不实现分布式/多机管理
- 不实现权限控制系统

## 4. 术语（Glossary）

- **PTY**：Pseudo Terminal，伪终端
- **Session**：一个 PTY 进程从启动到结束的生命周期
- **SessionId**：Session 的唯一标识符
- **Output Buffer**：为每个 Session 保存的输出环形/滚动缓冲区（字符串）

## 5. 约束与假设（Constraints & Assumptions）

- 运行环境：Node.js（当前实现以 Node 18+ 为最低目标；开发环境为 Node 24）
- PTY 实现：使用 `node-pty`（在 Windows/WSL2 必须可用）
- PTY 输出为 stdout/stderr 合并流；ANSI 转义序列原样保留

## 6. 需求（Requirements）

### 6.1 功能需求（FR）

**REQ-001（Spawn 基础）**：系统必须能通过 PTY 启动新进程并返回 `sessionId`。  
**验收口径**：调用 `spawn('node', …)` 返回非空 `sessionId`，且 `getStatus(sessionId).status === 'running'`。

**REQ-002（Spawn 选项）**：`spawn` 必须支持 `args/cwd/env/cols/rows`，并有默认终端尺寸 `80x24`。  
**验收口径**：传入 `cols/rows` 可影响 `resize` 前的初始尺寸；`env` 需支持覆盖/追加。

**REQ-003（实时输出捕获）**：系统必须实时捕获 PTY 输出，并通过事件与缓冲区提供读取。  
**验收口径**：启动持续输出的进程后，在进程运行中能读取到逐步增长的输出。

**REQ-004（GetOutput）**：系统必须支持按 `sessionId` 获取完整输出字符串；不存在时抛出 `SessionNotFoundError`。  
**验收口径**：对不存在的 `sessionId` 调用 `getOutput` 会抛出带 `code=SESSION_NOT_FOUND` 的错误。

**REQ-005（输出缓冲上限）**：每个 Session 的输出缓冲必须有上限（默认 1MB），超出时滚动丢弃最早内容。  
**验收口径**：输出超过上限后，缓冲区长度不超过上限，且末尾包含最新输出片段。

**REQ-005A（增量日志读取）**：系统必须支持按 `offset/limit` 增量读取输出（类似 `process log`），并在缓冲区已丢弃旧内容时告知截断。  
**验收口径**：提供 `readOutput(sessionId, { offset, limit })`（或等价 API），返回 `nextOffset` 作为下一次读取游标；当 `offset < startOffset` 时返回 `truncated=true` 且自动将 `offset` 跳至 `startOffset`。

**REQ-006（Write）**：系统必须支持向运行中的 Session 发送文本输入与常用特殊按键序列。  
**验收口径**：向交互式进程写入文本可触发可观测输出；对已结束 Session 写入返回失败/或抛出可识别错误。

**REQ-007（Status）**：系统必须支持按 `sessionId` 查询状态：`running/exited/killed`，并包含 `pid/startTime/endTime/exitCode/outputLength` 等字段。  
**验收口径**：进程退出后 `status !== 'running'` 且 `endTime !== null`，`exitCode` 合理。

**REQ-008（Kill）**：系统必须支持 `kill(sessionId, signal)`，signal 支持 `SIGTERM`（默认）/`SIGKILL`/`SIGINT`。  
**验收口径**：对长时间运行进程执行 `kill` 后，状态最终变为 `killed` 或 `exited`（由平台行为决定），并记录结束时间。

**REQ-009（ListSessions）**：系统必须支持列出当前所有 Session 的状态列表。  
**验收口径**：创建多个 Session 后 `listSessions()` 返回包含对应 `sessionId` 的条目。

**REQ-010（Cleanup + TTL）**：系统必须支持清理已结束 Session，并支持可配置 TTL（默认 5 分钟）自动清理。  
**验收口径**：结束 Session 后，`cleanup(sessionId)` 会移除并返回该 `sessionId`；超过 TTL 的已结束 Session 会被自动移除。

**REQ-011（Resize）**：系统必须支持在 Session 存在时调整终端尺寸。  
**验收口径**：调用 `resize(sessionId, cols, rows)` 不抛错，且对后续交互程序（如 `bash`）行为可观测（测试至少保证 API 可调用）。

**REQ-012（Events）**：系统必须提供事件：`output(sessionId, data)` 与 `exit(sessionId, exitCode)`。  
**验收口径**：启动输出型进程时能收到 output 事件；进程结束时能收到 exit 事件一次。

**REQ-013（Destroy）**：系统必须支持销毁管理器并终止所有仍在运行的进程。  
**验收口径**：创建多个长运行 Session 后调用 `destroy()`，它们最终都不再是 `running`，且管理器不再返回任何 Session。

### 6.2 非功能需求（NFR）

**NFR-001（并发）**：支持并发 Session 数 ≥ 50。  
**验收口径**：本仓库提供压力测试脚本/测试（至少 10 并发自动化；50 并发可手动/可选 CI）。

**NFR-002（输出延迟）**：输出捕获延迟目标 ≤ 10ms（以事件回调到达时间近似）。  
**验收口径**：提供基准脚本记录延迟分布（目标口径，不作为阻塞门槛）。

**NFR-003（内存）**：空载 ≤ 50MB；50 Session ≤ 200MB（目标值）。  
**验收口径**：提供基准脚本观测 RSS（目标口径，不作为阻塞门槛）。

**NFR-004（兼容性）**：Windows 10/11 与 WSL2 Ubuntu 必须支持；macOS/Linux 为可选。  
**验收口径**：仓库提供 Windows/WSL2 手动验收步骤；关键用例在两平台均可运行。

**NFR-005（可靠性）**：异常退出必须正确更新状态；进程退出后不应留下僵尸进程。  
**验收口径**：至少包含回归测试覆盖退出路径；并在 `destroy()`/进程 exit 钩子里做清理。

## 7. 对外 API（Contract）

API 以 `PTYManager` 类为核心，详见 `docs/plan/v1-index.md` 中的版本化实现计划与追溯矩阵；类型与错误码遵循 `spec.md` 中的结构（作为初始参考输入）。

输出读取建议：
- `getOutput(sessionId)`：一次性拿到当前缓冲区内的全部输出（适合 debug）
- `readOutput/session log`：按 `offset/limit` 增量读取（更适合作为工具系统的 `process log` 接口）
