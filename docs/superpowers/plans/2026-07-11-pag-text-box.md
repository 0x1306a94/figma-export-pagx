# PAG 点文本 / 框文本（对齐 AE + 官方规则）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [PAG 官方点/框文本规则](https://pag.io/docs/editable-text.html) 与 AE `TextDocument` 模型，从 Figma `textAutoResize` 导出正确的点文本或框文本，并映射对齐/行距/字距。

**Architecture:** `text-document.ts` 纯函数决定 `point|box` 并填充 `PagTextDocument`；点文本覆盖 Layer `anchor/position`（基线坐标系）；框文本保持现有中心锚点 + `boxTextPos=(0,0)`。编码层已支持字段，仅补 `ParagraphJustification`。

**Tech Stack:** TypeScript Figma plugin、`src/export/pag/*`、Vitest

**Spec:** `docs/superpowers/specs/2026-07-11-pag-text-box-design.md`

---

### Task 1: ParagraphJustification + 布局模式 / 字段映射（TDD）

**Files:**
- Modify: `src/export/pag/types.ts`
- Create: `src/export/pag/text-document.ts`
- Create: `test/pag-text-document.test.ts`

- [x] **Step 1: 扩展枚举**（与 `libpag/include/pag/types.h` 一致）
- [x] **Step 2–4: 纯函数 + 单测通过**
- [ ] **Step 5: Commit**（待用户确认）

```typescript
export enum ParagraphJustification {
  LeftJustify = 0,
  CenterJustify = 1,
  RightJustify = 2,
  FullJustifyLastLineLeft = 3,
  FullJustifyLastLineRight = 4,
  FullJustifyLastLineCenter = 5,
  FullJustifyLastLineFull = 6,
}
```

- [ ] **Step 2: 写失败单测**（纯函数不依赖 `figma` 全局）

```typescript
import { describe, expect, it } from 'vitest';
import { ParagraphJustification } from '../src/export/pag/types';
import {
  estimateFirstBaseLine,
  justificationFromAlign,
  leadingFromLineHeight,
  textLayoutModeFromAutoResize,
  trackingFromLetterSpacing,
} from '../src/export/pag/text-document';

describe('textLayoutModeFromAutoResize', () => {
  it('WIDTH_AND_HEIGHT → point', () => {
    expect(textLayoutModeFromAutoResize('WIDTH_AND_HEIGHT')).toBe('point');
  });
  it('NONE / HEIGHT / TRUNCATE → box', () => {
    expect(textLayoutModeFromAutoResize('NONE')).toBe('box');
    expect(textLayoutModeFromAutoResize('HEIGHT')).toBe('box');
    expect(textLayoutModeFromAutoResize('TRUNCATE')).toBe('box');
  });
});

describe('justificationFromAlign', () => {
  it('maps LEFT/CENTER/RIGHT/JUSTIFIED', () => {
    expect(justificationFromAlign('LEFT')).toBe(ParagraphJustification.LeftJustify);
    expect(justificationFromAlign('CENTER')).toBe(ParagraphJustification.CenterJustify);
    expect(justificationFromAlign('RIGHT')).toBe(ParagraphJustification.RightJustify);
    expect(justificationFromAlign('JUSTIFIED')).toBe(
      ParagraphJustification.FullJustifyLastLineLeft,
    );
  });
});

describe('leadingFromLineHeight', () => {
  it('AUTO → 0；PIXEL → value；PERCENT → fontSize*p/100', () => {
    expect(leadingFromLineHeight({ unit: 'AUTO' }, 24)).toBe(0);
    expect(leadingFromLineHeight({ unit: 'PIXELS', value: 36 }, 24)).toBe(36);
    expect(leadingFromLineHeight({ unit: 'PERCENT', value: 150 }, 24)).toBe(36);
  });
});

describe('trackingFromLetterSpacing', () => {
  it('PIXEL / PERCENT → AE tracking', () => {
    expect(trackingFromLetterSpacing({ unit: 'PIXELS', value: 2.4 }, 24)).toBe(100);
    expect(trackingFromLetterSpacing({ unit: 'PERCENT', value: 10 }, 24)).toBe(100);
  });
});

describe('estimateFirstBaseLine', () => {
  it('0.8 * fontSize', () => {
    expect(estimateFirstBaseLine(20)).toBe(16);
  });
});
```

- [ ] **Step 3: 实现 `text-document.ts` 核心**

```typescript
export type TextLayoutMode = 'point' | 'box';

export function textLayoutModeFromAutoResize(autoResize: string): TextLayoutMode {
  return autoResize === 'WIDTH_AND_HEIGHT' ? 'point' : 'box';
}

export function estimateFirstBaseLine(fontSize: number): number {
  return fontSize * 0.8;
}

// justificationFromAlign / leadingFromLineHeight / trackingFromLetterSpacing
// 签名只收已解析值，null = mixed

export function buildTextDocumentFields(input: {
  mode: TextLayoutMode;
  size: { width: number; height: number };
  fontSize: number;
  fontFamily: string;
  fontStyle: string;
  text: string;
  align: string;
  lineHeight: { unit: string; value?: number } | null;
  letterSpacing: { unit: string; value?: number } | null;
  fillColor: PagColor;
}): PagTextDocument {
  const base = { /* applyFill 等默认 */ };
  if (input.mode === 'point') {
    return {
      ...base,
      boxText: false,
      firstBaseLine: 0,
      boxTextPos: { x: 0, y: 0 },
      boxTextSize: { x: 0, y: 0 },
      // + font/text/justification/leading/tracking
    };
  }
  return {
    ...base,
    boxText: true,
    firstBaseLine: estimateFirstBaseLine(input.fontSize),
    boxTextPos: { x: 0, y: 0 },
    boxTextSize: { x: input.size.width, y: input.size.height },
    // + ...
  };
}
```

另提供 `buildTextDocument(node, size, diagnostics, fill)` 包装：读 node、发 warning、调上面纯函数。

Warning 规则：

- `NONE` + `TOP` → `TEXT_BOX_VERTICAL_CENTER`（说明 PAG 会强制垂直居中）
- `BOTTOM` → `TEXT_VERTICAL_ALIGN`
- `TRUNCATE` → `TEXT_TRUNCATE_AS_BOX`
- mixed font → `TEXT_MIXED_STYLE`

- [ ] **Step 4: `npx vitest run test/pag-text-document.test.ts` 全绿**

- [ ] **Step 5: Commit**

```bash
git add src/export/pag/types.ts src/export/pag/text-document.ts test/pag-text-document.test.ts
git commit -m "$(cat <<'EOF'
feat: map Figma textAutoResize to PAG point vs box text

EOF
)"
```

---

### Task 2: 点文本 Transform 覆盖

**Files:**
- Modify: `src/export/pag/text-document.ts`（`pointTextTransformOverride`）
- Modify: `test/pag-text-document.test.ts`

- [ ] **Step 1: 单测**

```typescript
describe('pointTextAnchorPosition', () => {
  // left=10, top=20, w=100, h=40, fontSize=20 → baselineY = 20+16 = 36
  it('LEFT → position (left, baselineY)', () => {
    expect(pointTextAnchorPosition({
      left: 10, top: 20, width: 100, height: 40, fontSize: 20, align: 'LEFT',
    })).toEqual({ anchor: { x: 0, y: 0 }, position: { x: 10, y: 36 } });
  });
  it('CENTER → position (left+w/2, baselineY)', () => {
    expect(pointTextAnchorPosition({
      left: 10, top: 20, width: 100, height: 40, fontSize: 20, align: 'CENTER',
    })).toEqual({ anchor: { x: 0, y: 0 }, position: { x: 60, y: 36 } });
  });
  it('RIGHT → position (left+w, baselineY)', () => {
    expect(pointTextAnchorPosition({
      left: 10, top: 20, width: 100, height: 40, fontSize: 20, align: 'RIGHT',
    })).toEqual({ anchor: { x: 0, y: 0 }, position: { x: 110, y: 36 } });
  });
});
```

- [ ] **Step 2: 实现并跑绿**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: place PAG point text on baseline axis like AE

EOF
)"
```

---

### Task 3: 接入 mapTextLayer

**Files:**
- Modify: `src/export/pag/figma-to-pag.ts`
- Modify: `test/pag-export.test.ts` 或新建 `test/pag-text-export.test.ts`

- [ ] **Step 1: 集成测**

- mock `WIDTH_AND_HEIGHT` → `sourceText.boxText === false`，且 transform position 为基线启发式  
- mock `NONE` → `boxText === true`，`boxTextSize` 等于节点尺寸，transform 仍为中心锚点  

- [ ] **Step 2: 改 `mapTextLayer`**

```
size ← resolvedSize
base ← layerBase(...)  // 默认中心
mode ← textLayoutModeFromAutoResize(node.textAutoResize)
if mode == 'point' && !motion animated position:
  {anchor, position} ← pointTextAnchorPosition(...)
  base.transform.anchorPoint / position ← static
  // 若有 motion：v1 warning TEXT_POINT_MOTION，仍用 motion 采样（或跳过覆盖）
sourceText ← buildTextDocument(...)
return Text layer
```

- [ ] **Step 3: `npm test`**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: wire point/box text into PAG mapTextLayer

EOF
)"
```

---

### Task 4: 文档

**Files:**
- Modify: `docs/pag-export-design.md`
- Modify: `docs/superpowers/specs/2026-07-11-pag-text-box-design.md`（状态 → 已实现）

- [ ] 关键约定表增加文本行，并链到 https://pag.io/docs/editable-text.html  
- [ ] Commit docs

---

### Task 5: 手工验收

- [ ] 点文本（自动宽高）单行：PAGViewer 位置/对齐接近 Figma，无意外缩字号  
- [ ] 框文本 `HEIGHT` 多行：软换行，垂直大致顶对齐（框高紧）  
- [ ] 框文本 `NONE` 高框短文：确认出现官方所述垂直居中（预期行为，非 bug）

---

## Self-review

| Spec | Task |
|------|------|
| D1 点/框分流 | Task 1 |
| D2 点文本基线变换 | Task 2–3 |
| D3 框文本 warning | Task 1 |
| D4 对齐/行距/字距 | Task 1 |
| 官方文档行为 | Task 5 |

**Out of scope：** PAGX、Animator、Path、竖排、字体嵌入、导出侧预缩字号、框高自动收到临界像素。
