---
name: exp
description: 标记项目经验。触发词：/exp、提炼经验、记录这个坑。只做轻量标记，不写文件。
---

# /exp — 标记项目经验

**目的：** 在开发过程中随手标记经验，不打断工作流。实际页面生成交给 SessionEnd 后的 Ingest 管线。

## 行为

1. 回顾最近几轮对话，提取关键信息（错误信息、决策背景、操作步骤等）
2. 确认类型（bug | decision | howto | agent-error | pattern | template），用户未指定则推断
3. 提炼一句话标题（中文）和 3-5 个技术关键词
4. 仅在对话中输出轻量标记（**不写文件、不更新 wiki、不更新 index、不更新 log**）
5. 告知用户类型和标题，确认已标记

## 标记格式

```
[EXP]
type: bug
title: _estack 符号冲突导致 HardFault
keywords: linker script, startup, stack pointer, symbol conflict
note: startup.s 和 linker.ld 重复定义 _estack，导致复位后 SP 指向错误地址，设备立即进入 HardFault。删除汇编中的重复定义即可修复。
```

## 示例

```
用户: /exp 刚才那个 FreeRTOS 任务栈溢出的坑

Claude: [已标记] bug · FreeRTOS 任务栈溢出导致 HardFault · 会话结束后自动提取

[EXP]
type: bug
title: FreeRTOS 任务栈溢出导致 HardFault
keywords: FreeRTOS, stack overflow, vTaskAddApplicationHook, HardFault, configCHECK_FOR_STACK_OVERFLOW
note: 未开启栈溢出检测导致 HardFault 无栈回溯信息。开启 configCHECK_FOR_STACK_OVERFLOW 选项 2 后定位到 taskA 栈仅 128 字节但递归调用占用 >512 字节。
```

## 注意事项

- 标记只是轻量提示，供 Ingest 管线中的 LLM 参考
- 最终经验页面的标题、结构、关联仍由 Ingest 管线生成
- SessionEnd 后这些标记会随 transcript 一起被处理
- 如果标记时记错了或描述不准确，不影响——Ingest 会有完整的 transcript 上下文
