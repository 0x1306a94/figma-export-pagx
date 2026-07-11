# 插件 UI 面板美化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or implement inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分区纵向美化插件面板：导出联动态、动画 JSON 开关、文件大小格式化、去掉关闭按钮。

**Architecture:** 纯 UI 改动集中在 `ui.html`；`src/code.ts` 仅删除 `cancel` 并下调 `showUI` 高度。

**Tech Stack:** 静态 HTML/CSS/JS（Figma plugin UI）、TypeScript plugin main

**Spec:** `docs/superpowers/specs/2026-07-11-plugin-ui-polish-design.md`

---

### Task 1: `ui.html` 布局 + 行为

**Files:**
- Modify: `ui.html`

- [x] 分区标题（准备 / 导出 / 开发者）
- [x] 去掉关闭按钮
- [x] 动画数据 checkbox 开关（默认关）
- [x] `formatBytes` + meta 展示
- [x] `setExportBusy` 仅在导出结束消息时清除；其它消息不动导出按钮

### Task 2: `src/code.ts` 清理

**Files:**
- Modify: `src/code.ts`

- [x] 删除 `cancel` 类型与处理
- [x] `showUI` height `560` → `420`

### Task 3: 构建验证

- [x] `npm run build`
- [x] Spec 状态改为已实现
