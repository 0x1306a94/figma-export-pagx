# PAG SolidLayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline in this session).

**Goal:** Figma 图层名 `#solid` 前缀导出为 PAG `SolidLayer`，支持运行时 `setSolidColor`。

**Architecture:** 共享 `parseSolidMarker`；PAG 路径校验资格并写 `PagSolidLayer` + `TagCode.SolidColor`；PAGX 仅去前缀。条件失败 `throw` 中断导出。

**Tech Stack:** TypeScript Figma plugin、现有 `src/export/pag/*`

**Spec:** `docs/superpowers/specs/2026-07-10-pag-solid-layer-design.md`

---

### Task 1: parseSolidMarker + IR/encode

**Files:**
- Create: `src/export/solid-marker.ts`
- Modify: `src/export/pag/types.ts`, `encode/encode-layer.ts`, `encode/data-types.ts`（若缺 writeColor）
- Test: `test/pag-export.test.ts`

- [ ] 实现 `parseSolidMarker(name)` → `{ isSolid, exportName }`
- [ ] 增加 `PagSolidLayer`，`writeSolidColor`，`writeLayer` case Solid
- [ ] 测试：encode 最小 Solid PAG；marker 解析

### Task 2: figma-to-pag 映射

**Files:**
- Modify: `src/export/pag/figma-to-pag.ts`
- Test: `test/pag-export.test.ts`

- [ ] `assertSolidEligible` / `mapSolidLayer`
- [ ] `mapGeometryLayer` 优先走 Solid
- [ ] 不合格 throw；size 动画 throw
- [ ] layerBase 使用 `exportName`

### Task 3: PAGX 去前缀

**Files:**
- Modify: `src/export/figma-to-pagx.ts`（图层 name 写入处）

- [ ] 写 Layer name 时 `parseSolidMarker` 去前缀

### Task 4: 验证

- [ ] `npm test` 全绿
- [ ] 更新 spec 状态为已实现
