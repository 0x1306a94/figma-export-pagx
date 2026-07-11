# 导出帧率可配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导出默认 30fps，面板下拉可选 24/30/60 并持久化，PAGX/PAG 共用，帧率作为参数传入换算逻辑。

**Architecture:** `ExportOptions.frameRate` 从 UI → `code.ts` → `exportPagx`/`exportPag` → `ExportContext`/`PagExportContext` → `collectMotionAnimations` / `collectPagMotionFrames`。`MOTION_FRAME_RATE` 改为默认常量 30；`secondsToFrame` 及 bake 路径接收显式 `frameRate`。

**Tech Stack:** TypeScript Figma plugin、esbuild 测试脚本

**Spec:** `docs/superpowers/specs/2026-07-11-export-frame-rate-design.md`

---

### File map

| File | Change |
|------|--------|
| `src/export/figma-motion.ts` | `MOTION_FRAME_RATE=30`；`ALLOWED_FRAME_RATES`；thread `frameRate` |
| `src/export/types.ts` | `ExportOptions`；`ExportContext.frameRate` |
| `src/export/index.ts` | `exportPagx(root, options?)` |
| `src/export/figma-to-pagx.ts` | context + `collectMotionAnimations(..., ctx.frameRate)` |
| `src/export/pag/figma-to-pag.ts` | `PagExportContext.frameRate`；composition 用 `ctx.frameRate` |
| `src/code.ts` | 校验消息 `frameRate`，传入导出 |
| `ui.html` | select + localStorage + busy disabled |
| `test/figma-motion.test.ts` | 旧断言传 `60`；新增默认 30 |
| `test/pag-export.test.ts` | 显式 `frameRate: 60` 或适配 |
| `docs/static-and-motion-export.md` / `docs/pag-export-design.md` | 文档 |

---

### Task 1: motion 换算接受 frameRate（默认 30）

**Files:**
- Modify: `src/export/figma-motion.ts`
- Modify: `test/figma-motion.test.ts`

- [ ] **Step 1: 改常量与换算**

```typescript
export const MOTION_FRAME_RATE = 30;
export const ALLOWED_FRAME_RATES = [24, 30, 60] as const;
export type AllowedFrameRate = (typeof ALLOWED_FRAME_RATES)[number];

function secondsToFrame(seconds: number, frameRate: number): number {
  return Math.max(0, Math.round(seconds * frameRate));
}
```

将 `frameRate` 传入：`buildFloatChannel`、`buildAlphaChannel`、`buildMatrixSampleTimes`、`buildMatrixChannel`、`keyframesFromFloatSamples`、`buildFloatSamplesChannel`、`buildSizeScaleChannels`、`buildGroupTransformChannels`、`collectPagMotionFrames`、`collectMotionAnimations`（末参默认 `MOTION_FRAME_RATE`）。`buildMatrixSampleTimes` 内 `frame / frameRate`。`*ForTest` 包装同步加可选 `frameRate`。

- [ ] **Step 2: 更新测试**

`collectMotionAnimations(..., diagnostics, 60)` 保持 `[65, 90]` 等 60fps 断言。新增：

```typescript
function testDefaultFrameRateIs30(): void {
  // 同 opacity timelineOffset 用例，不传 frameRate
  // expect animations[0].frameRate === 30
  // expect times [33, 45]  // 1.09*30, 1.5*30
}
```

- [ ] **Step 3: 跑测**

Run: `npm test`（或至少 figma-motion + pag-export）

- [ ] **Step 4: Commit** `feat: make motion frame rate configurable (default 30)`

---

### Task 2: 导出 API / context 贯通

**Files:**
- Modify: `src/export/types.ts`
- Modify: `src/export/index.ts`
- Modify: `src/export/figma-to-pagx.ts`
- Modify: `src/export/pag/figma-to-pag.ts`

- [ ] **Step 1: 类型与入口**

```typescript
export type ExportOptions = { frameRate?: number };

// ExportContext / PagExportContext 增加 frameRate: number
// createExportContext(root, frameRate = MOTION_FRAME_RATE)
// createPagExportContext(frameRate = MOTION_FRAME_RATE)

export async function exportPagx(root: SceneNode, options?: ExportOptions) {
  const frameRate = options?.frameRate ?? MOTION_FRAME_RATE;
  const ctx = createExportContext(root, frameRate);
  ...
}
export async function exportPag(root: SceneNode, options?: ExportOptions) {
  const frameRate = options?.frameRate ?? MOTION_FRAME_RATE;
  const ctx = createPagExportContext(frameRate);
  ...
}
```

composition / `collect*` 一律用 `ctx.frameRate`。

- [ ] **Step 2: 跑测 + Commit** `feat: thread frameRate through PAGX/PAG export`

---

### Task 3: UI + code.ts

**Files:**
- Modify: `ui.html`
- Modify: `src/code.ts`

- [ ] **Step 1: UI**

导出区按钮上方：

```html
<label class="frame-rate-row">
  <span>帧率</span>
  <select id="frame-rate">
    <option value="24">24</option>
    <option value="30" selected>30</option>
    <option value="60">60</option>
  </select>
</label>
```

`localStorage` key `figma-motion-export-pagx:frameRate`；`setExportBusy` 同时 disabled select；导出消息带 `frameRate: Number(select.value)`。

- [ ] **Step 2: code.ts**

```typescript
type PluginMessage =
  | { type: 'export-pagx'; frameRate?: number }
  | { type: 'export-pag'; frameRate?: number }
  | { type: 'refresh-motion-anchor' };

function resolveFrameRate(value: unknown): number {
  return value === 24 || value === 30 || value === 60 ? value : 30;
}
// exportPagx(root, { frameRate }) / exportPag(root, { frameRate })
```

- [ ] **Step 3: build + Commit** `feat: add frame rate select to plugin UI`

---

### Task 4: 文档

**Files:**
- Modify: `docs/static-and-motion-export.md`
- Modify: `docs/pag-export-design.md`

- [ ] 默认 60 → 默认 30，可选手动 24/30/60
- [ ] Commit `docs: update frame rate default to 30`

---

## Spec coverage

| Spec | Task |
|------|------|
| 默认 30 | 1 |
| 下拉 24/30/60 + localStorage | 3 |
| 共用控件 / 参数传递 | 2–3 |
| 测试显式 60 + 默认 30 | 1 |
| 文档 | 4 |
| 非法值回落 | 3 (`resolveFrameRate`) |
