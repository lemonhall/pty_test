明白了！你要的是一份正经的**软件需求规格说明书（SRS）**，而不是代码。

让我帮你写一份完整的文档，涵盖：需求规格、技术规格、接口契约、测试范围、交付验收标准。

---

# PTY 进程管理器 - 需求规格说明书

**项目名称**：pty_test
**版本**：v0.1.0
**作者**：柠檬叔
**日期**：2026-02-04
**状态**：草稿

---

## 一、项目概述

### 1.1 背景

在研究 OpenClaw（Lobster/龙虾）的工具系统时，发现其 `exec/process` 工具组采用了一种优雅的异步进程管理模式：通过伪终端（PTY）启动进程，实时捕获输出，支持动态发送输入，并能在进程运行期间随时查询状态。

本项目旨在用 Node.js 复现这套机制，作为技术验证和学习实践。

### 1.2 目标

构建一个轻量级的 PTY 进程管理器，具备以下能力：

1. **启动进程**：通过 PTY 启动任意命令行程序
2. **输出捕获**：实时捕获 stdout/stderr 的混合输出
3. **输入发送**：向运行中的进程发送输入（包括特殊按键如 Ctrl+C）
4. **状态查询**：查询进程的运行状态、退出码、输出内容
5. **进程终止**：强制终止运行中的进程
6. **会话管理**：支持多个进程并发运行，通过 sessionId 区分

### 1.3 非目标（Scope 外）

- 不实现 Web UI 或 REST API（纯 Node.js 模块）
- 不实现进程间通信（IPC）
- 不实现分布式部署
- 不实现权限控制系统

### 1.4 参考实现

- OpenClaw `exec/process` 工具组
- [node-pty](https://github.com/microsoft/node-pty) 库

---

## 二、术语定义

| 术语 | 定义 |
|------|------|
| **PTY** | Pseudo Terminal，伪终端。一种模拟物理终端的软件抽象，允许程序像在真实终端中一样运行 |
| **Session** | 会话。一个 PTY 进程的完整生命周期，从启动到终止 |
| **SessionId** | 会话标识符。用于唯一标识一个 Session 的字符串 |
| **Output Buffer** | 输出缓冲区。存储进程输出内容的内存区域 |

---

## 三、功能需求

### 3.1 进程启动（spawn）

**FR-001**：系统应能通过 PTY 启动一个新进程

| 属性 | 描述 |
|------|------|
| 输入 | 命令（command）、参数（args）、工作目录（cwd）、环境变量（env）、终端尺寸（cols/rows） |
| 输出 | 会话标识符（sessionId） |
| 前置条件 | 无 |
| 后置条件 | 进程已启动，Session 已创建并存入管理器 |

**FR-002**：系统应支持自定义终端尺寸

- 默认值：80 列 × 24 行
- 可选范围：cols 1-500，rows 1-200

**FR-003**：系统应支持自定义环境变量

- 默认继承当前进程的环境变量
- 可追加或覆盖指定变量

---

### 3.2 输出捕获（output）

**FR-010**：系统应实时捕获进程的所有输出

- 包括 stdout 和 stderr（PTY 模式下两者合并）
- 包括 ANSI 转义序列（颜色、光标控制等）

**FR-011**：系统应支持查询指定 Session 的输出内容

| 属性 | 描述 |
|------|------|
| 输入 | sessionId |
| 输出 | 完整输出内容（字符串） |

**FR-012**：系统应支持输出缓冲区大小限制

- 默认上限：1MB
- 超出时采用滚动策略：丢弃最早的内容

---

### 3.3 输入发送（write）

**FR-020**：系统应支持向运行中的进程发送文本输入

| 属性 | 描述 |
|------|------|
| 输入 | sessionId、文本内容（text） |
| 输出 | 成功/失败 |
| 前置条件 | Session 存在且进程正在运行 |

**FR-021**：系统应支持发送特殊按键

| 按键 | 编码 |
|------|------|
| Enter | `\r` 或 `\n` |
| Ctrl+C | `\x03` |
| Ctrl+D | `\x04` |
| Ctrl+Z | `\x1a` |
| Tab | `\t` |
| Backspace | `\x7f` |
| 方向键上 | `\x1b[A` |
| 方向键下 | `\x1b[B` |
| 方向键右 | `\x1b[C` |
| 方向键左 | `\x1b[D` |

---

### 3.4 状态查询（status）

**FR-030**：系统应支持查询 Session 的当前状态

| 属性 | 描述 |
|------|------|
| 输入 | sessionId |
| 输出 | 状态对象（见下表） |

**状态对象结构**：

| 字段 | 类型 | 描述 |
|------|------|------|
| sessionId | string | 会话标识符 |
| status | enum | `running` / `exited` / `killed` |
| exitCode | number \| null | 退出码（仅当 status 非 running 时有值） |
| pid | number | 进程 ID |
| startTime | Date | 启动时间 |
| endTime | Date \| null | 结束时间 |
| command | string | 执行的命令 |
| outputLength | number | 当前输出缓冲区大小（字节） |

---

### 3.5 进程终止（kill）

**FR-040**：系统应支持终止运行中的进程

| 属性 | 描述 |
|------|------|
| 输入 | sessionId、信号（signal，可选） |
| 输出 | 成功/失败 |
| 前置条件 | Session 存在 |

**FR-041**：系统应支持多种终止信号

| 信号 | 说明 |
|------|------|
| SIGTERM（默认） | 请求进程正常退出 |
| SIGKILL | 强制终止进程 |
| SIGINT | 模拟 Ctrl+C |

---

### 3.6 会话管理（session）

**FR-050**：系统应支持列出所有 Session

| 属性 | 描述 |
|------|------|
| 输入 | 无 |
| 输出 | Session 状态列表 |

**FR-051**：系统应支持清理已结束的 Session

| 属性 | 描述 |
|------|------|
| 输入 | sessionId（可选，不传则清理所有已结束的） |
| 输出 | 被清理的 sessionId 列表 |

**FR-052**：系统应支持设置 Session 自动清理策略

- 可配置：已结束的 Session 保留时长（默认 5 分钟）
- 超时后自动从管理器中移除

---

## 四、非功能需求

### 4.1 性能

| 指标 | 要求 |
|------|------|
| 并发 Session 数 | ≥ 50 |
| 输出捕获延迟 | ≤ 10ms |
| 内存占用（空载） | ≤ 50MB |
| 内存占用（50 Session） | ≤ 200MB |

### 4.2 兼容性

| 平台 | 支持状态 |
|------|----------|
| Windows 10/11 | ✅ 必须支持 |
| WSL2 Ubuntu | ✅ 必须支持 |
| macOS | ⚪ 可选支持 |
| Linux | ⚪ 可选支持 |

### 4.3 可靠性

- 进程异常退出时，Session 状态应正确更新
- 管理器自身崩溃时，不应留下僵尸进程
- 输出缓冲区溢出时，不应导致内存泄漏

---

## 五、接口契约（API Contract）

### 5.1 类定义

```typescript
interface PTYManagerOptions {
  maxOutputSize?: number;      // 输出缓冲区上限，默认 1MB
  sessionTTL?: number;         // 已结束 Session 保留时长（ms），默认 300000
  defaultCols?: number;        // 默认终端列数，默认 80
  defaultRows?: number;        // 默认终端行数，默认 24
}

interface SpawnOptions {
  args?: string[];             // 命令参数
  cwd?: string;                // 工作目录
  env?: Record<string, string>;// 环境变量（追加/覆盖）
  cols?: number;               // 终端列数
  rows?: number;               // 终端行数
}

interface SessionStatus {
  sessionId: string;
  status: 'running' | 'exited' | 'killed';
  exitCode: number | null;
  pid: number;
  startTime: Date;
  endTime: Date | null;
  command: string;
  args: string[];
  cwd: string;
  outputLength: number;
}

interface WriteResult {
  success: boolean;
  error?: string;
}

interface KillResult {
  success: boolean;
  error?: string;
}
```

### 5.2 方法签名

```typescript
class PTYManager {
  constructor(options?: PTYManagerOptions);

  /**
   * 启动新进程
   * @returns sessionId
   */
  spawn(command: string, options?: SpawnOptions): string;

  /**
   * 获取输出内容
   * @throws SessionNotFoundError
   */
  getOutput(sessionId: string): string;

  /**
   * 发送输入
   * @throws SessionNotFoundError
   */
  write(sessionId: string, text: string): WriteResult;

  /**
   * 查询状态
   * @throws SessionNotFoundError
   */
  getStatus(sessionId: string): SessionStatus;

  /**
   * 终止进程
   * @throws SessionNotFoundError
   */
  kill(sessionId: string, signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): KillResult;

  /**
   * 列出所有 Session
   */
  listSessions(): SessionStatus[];

  /**
   * 清理 Session
   * @returns 被清理的 sessionId 列表
   */
  cleanup(sessionId?: string): string[];

  /**
   * 调整终端尺寸
   * @throws SessionNotFoundError
   */
  resize(sessionId: string, cols: number, rows: number): void;

  /**
   * 注册事件监听
   */
  on(event: 'output', listener: (sessionId: string, data: string) => void): this;
  on(event: 'exit', listener: (sessionId: string, exitCode: number) => void): this;

  /**
   * 销毁管理器，终止所有进程
   */
  destroy(): void;
}
```

### 5.3 错误定义

```typescript
class PTYError extends Error {
  code: string;
}

class SessionNotFoundError extends PTYError {
  code = 'SESSION_NOT_FOUND';
  sessionId: string;
}

class SessionNotRunningError extends PTYError {
  code = 'SESSION_NOT_RUNNING';
  sessionId: string;
  currentStatus: string;
}

class SpawnError extends PTYError {
  code = 'SPAWN_FAILED';
  command: string;
  originalError: Error;
}
```

---

## 六、测试范围

### 6.1 单元测试

| 测试编号 | 测试项 | 测试描述 | 优先级 |
|----------|--------|----------|--------|
| UT-001 | spawn 基础 | 启动简单命令（echo hello），验证返回 sessionId | P0 |
| UT-002 | spawn 参数 | 启动带参数的命令，验证参数正确传递 | P0 |
| UT-003 | spawn 工作目录 | 指定 cwd，验证进程在正确目录启动 | P1 |
| UT-004 | spawn 环境变量 | 指定 env，验证环境变量正确设置 | P1 |
| UT-005 | getOutput 基础 | 获取已完成进程的输出 | P0 |
| UT-006 | getOutput 实时 | 进程运行中获取输出，验证实时性 | P0 |
| UT-007 | getOutput 不存在 | 查询不存在的 sessionId，验证抛出异常 | P0 |
| UT-008 | write 基础 | 向交互式进程发送输入 | P0 |
| UT-009 | write 特殊键 | 发送 Ctrl+C，验证进程响应 | P0 |
| UT-010 | write 已结束 | 向已结束进程发送输入，验证返回错误 | P1 |
| UT-011 | getStatus 运行中 | 查询运行中进程状态 | P0 |
| UT-012 | getStatus 已结束 | 查询已结束进程状态，验证 exitCode | P0 |
| UT-013 | kill 基础 | 终止运行中进程 | P0 |
| UT-014 | kill SIGKILL | 使用 SIGKILL 强制终止 | P1 |
| UT-015 | listSessions | 列出多个 Session | P1 |
| UT-016 | cleanup | 清理已结束 Session | P1 |
| UT-017 | resize | 调整终端尺寸 | P2 |
| UT-018 | destroy | 销毁管理器，验证所有进程终止 | P1 |

### 6.2 集成测试

| 测试编号 | 测试项 | 测试描述 | 优先级 |
|----------|--------|----------|--------|
| IT-001 | 完整生命周期 | spawn → write → getOutput → kill → cleanup | P0 |
| IT-002 | 并发 Session | 同时启动 10 个进程，验证互不干扰 | P0 |
| IT-003 | 长时间运行 | 启动一个运行 30 秒的进程，验证输出持续捕获 | P1 |
| IT-004 | 大量输出 | 进程输出超过 1MB，验证滚动策略生效 | P1 |
| IT-005 | 交互式程序 | 启动 node REPL，发送代码，验证输出 | P0 |
| IT-006 | Windows 命令 | 在 Windows 上运行 cmd /c dir | P0 |
| IT-007 | WSL 命令 | 在 WSL 中运行 bash -c "ls -la" | P1 |

### 6.3 边界测试

| 测试编号 | 测试项 | 测试描述 | 优先级 |
|----------|--------|----------|--------|
| BT-001 | 空命令 | spawn("")，验证抛出异常 | P1 |
| BT-002 | 不存在的命令 | spawn("nonexistent_cmd")，验证错误处理 | P0 |
| BT-003 | 极大输出 | 进程输出 10MB，验证内存不泄漏 | P2 |
| BT-004 | 快速退出 | 进程立即退出，验证状态正确 | P1 |
| BT-005 | 僵尸进程 | 父进程退出后子进程状态 | P2 |

---

## 七、交付验收标准

### 7.1 代码交付物

| 交付物 | 描述 | 验收标准 |
|--------|------|----------|
| 源代码 | `src/` 目录下的所有代码 | 代码可运行，无语法错误 |
| 类型定义 | `types/index.d.ts` | TypeScript 类型完整 |
| 单元测试 | `test/unit/` | 覆盖率 ≥ 80% |
| 集成测试 | `test/integration/` | 所有 P0 用例通过 |
| 文档 | `README.md` | 包含安装、使用、API 说明 |

### 7.2 功能验收

| 验收项 | 验收方法 | 通过标准 |
|--------|----------|----------|
| 基础功能 | 运行 demo 脚本 | 能启动进程、获取输出、发送输入 |
| 并发能力 | 运行并发测试 | 50 个 Session 同时运行无异常 |
| 跨平台 | 在 Windows 和 WSL 分别测试 | 两个平台均能正常工作 |
| 错误处理 | 运行边界测试 | 异常情况有明确错误信息 |

### 7.3 质量验收

| 指标 | 要求 |
|------|------|
| 单元测试覆盖率 | ≥ 80% |
| P0 测试用例通过率 | 100% |
| P1 测试用例通过率 | ≥ 90% |
| ESLint 检查 | 0 error，warning ≤ 10 |
| 无内存泄漏 | 运行 1 小时后内存增长 ≤ 10% |

### 7.4 验收流程

```
1. 代码审查
   ├── 检查代码结构是否符合规范
   ├── 检查类型定义是否完整
   └── 检查注释是否充分

2. 自动化测试
   ├── npm test（运行所有测试）
   ├── npm run test:coverage（检查覆盖率）
   └── npm run lint（代码规范检查）

3. 手动验收
   ├── 运行 demo 脚本，验证基础功能
   ├── 在 Windows PowerShell 中测试
   ├── 在 WSL Ubuntu 中测试
   └── 运行压力测试，验证并发能力

4. 文档审查
   ├── README 是否清晰
   ├── API 文档是否完整
   └── 示例代码是否可运行
```

---

## 八、里程碑计划

| 里程碑 | 内容 | 预计时间 |
|--------|------|----------|
| M1 | 基础框架搭建，spawn/getOutput 实现 | 2 小时 |
| M2 | write/kill/getStatus 实现 | 2 小时 |
| M3 | 会话管理、事件系统实现 | 1 小时 |
| M4 | 单元测试编写 | 2 小时 |
| M5 | 集成测试、跨平台验证 | 1 小时 |
| M6 | 文档编写、代码清理 | 1 小时 |
| **总计** | | **9 小时** |

---

## 九、风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| node-pty 在 Windows 上编译失败 | 中 | 高 | 使用预编译二进制，或改用 windows-build-tools |
| ANSI 转义序列处理复杂 | 低 | 中 | 暂不处理，原样保留在输出中 |
| 僵尸进程清理困难 | 低 | 中 | 使用 process.on('exit') 钩子确保清理 |
| 并发性能不达标 | 低 | 中 | 优化输出缓冲区实现，使用流式处理 |

---

## 十、附录

### A. 参考资料

1. [node-pty GitHub](https://github.com/microsoft/node-pty)
2. [OpenClaw 源码](https://github.com/anthropics/anthropic-quickstarts)
3. [PTY 原理介绍](https://en.wikipedia.org/wiki/Pseudoterminal)
4. [ANSI 转义序列](https://en.wikipedia.org/wiki/ANSI_escape_code)

### B. 修订历史

| 版本 | 日期 | 作者 | 修订内容 |
|------|------|------|----------|
| 0.1.0 | 2026-02-04 | 柠檬叔 | 初稿 |

---

**【文档结束】**

---

这份 SRS 大概 3000 字，涵盖了：

- ✅ 需求规格（功能需求 + 非功能需求）
- ✅ 技术规格（TypeScript 接口定义）
- ✅ 接口契约（完整的 API 签名和错误定义）
- ✅ 测试范围（单元测试 + 集成测试 + 边界测试）
- ✅ 交付验收（代码交付物 + 功能验收 + 质量验收 + 验收流程）

需要我调整或补充哪部分吗？比如：

1. 增加更多测试用例？
2. 细化某个接口的行为描述？
3. 添加时序图或状态图？
