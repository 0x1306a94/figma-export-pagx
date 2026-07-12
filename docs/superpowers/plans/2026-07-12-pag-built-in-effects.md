# PAG Built-in Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Figma `LAYER_BLUR` 和 `DROP_SHADOW` 直接编码为二进制 PAG 的 `FastBlurEffect` 与 `DropShadowStyleV2`。

**Architecture:** 扩展现有 PAG IR，在 `PagLayerBase` 保存 effects/layerStyles；Figma 映射只生成 IR，两个新 encoder 严格对齐 libpag TagBlock 字段顺序。PAGX 链路不参与且不修改。

**Tech Stack:** TypeScript、esbuild、项目自研 PAG encoder、libpag CLI

---

### Task 1: PAG IR 与 Figma 映射

**Files:**
- Modify: `src/export/pag/types.ts`
- Modify: `src/export/pag/figma-to-pag.ts`
- Modify: `test/pag-export.test.ts`

- [x] **Step 1: 写失败测试**

为 `mapNodeEffects()` 增加测试：普通 blur、progressive blur warning、阴影 offset/angle、RGBA、spread、隐藏效果。

```ts
const mapped = mapNodeEffects(nodeWithEffects, diagnostics);
assert(mapped.effects[0].kind === 'fastBlur');
assert(staticValue(mapped.effects[0].blurriness) === 20);
assert(mapped.layerStyles[0].kind === 'dropShadow');
assert(closeTo(staticValue(mapped.layerStyles[0].distance), 5));
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test`
Expected: FAIL，原因是 `mapNodeEffects` 和 PAG effect 类型尚不存在。

- [x] **Step 3: 实现最小 IR 与映射**

在 `PagLayerBase` 增加：

```ts
effects: PagEffect[];
layerStyles: PagLayerStyle[];
```

在 `layerBase()` 中调用 `mapNodeEffects()`；普通 blur 直接使用 radius；progressive blur降级并告警；阴影使用 `hypot/atan2` 计算 distance/angle，使用 `size=radius+spread` 与 `spread=spread/size`。

- [x] **Step 4: 运行测试并确认通过**

Run: `npm test`
Expected: 新增映射测试 PASS，编码测试因缺少 Tag writer 仍按后续任务补齐。

### Task 2: FastBlurEffect 二进制编码

**Files:**
- Create: `src/export/pag/encode/encode-effects.ts`
- Modify: `src/export/pag/encode/tag-code.ts`
- Modify: `src/export/pag/encode/encode-layer.ts`
- Modify: `test/pag-export.test.ts`

- [x] **Step 1: 写失败测试**

构造含静态 Fast Blur 的 PagLayer，编码后扫描顶层 LayerBlock 子 Tag，断言包含 Tag 60。

```ts
assert(layerTagCodes.includes(TagCode.FastBlurEffect));
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test`
Expected: FAIL，TagCode 或 writer 不存在。

- [x] **Step 3: 实现 Tag 60 writer**

字段顺序严格对齐 `FastBlurEffectTag()`：blurriness、blurDimensions、repeatEdgePixels、effectOpacity、空 mask references。复用 `writeTagBlock()` 和现有 property config。

- [x] **Step 4: 运行测试并确认通过**

Run: `npm test`
Expected: Fast Blur 编码测试 PASS。

### Task 3: DropShadowStyleV2 二进制编码

**Files:**
- Create: `src/export/pag/encode/encode-layer-styles.ts`
- Modify: `src/export/pag/encode/tag-code.ts`
- Modify: `src/export/pag/encode/encode-layer.ts`
- Modify: `test/pag-export.test.ts`

- [x] **Step 1: 写失败测试**

构造含 Drop Shadow 的 PagLayer，断言 LayerBlock 包含 Tag 65，并验证多个阴影均被写入。

```ts
assert(layerTagCodes.filter(code => code === TagCode.DropShadowStyleV2).length === 2);
```

- [x] **Step 2: 运行测试并确认失败**

Run: `npm test`
Expected: FAIL，DropShadowStyleV2 writer 不存在。

- [x] **Step 3: 实现 Tag 65 writer**

字段顺序严格对齐 `DropShadowStyleTagV2()`：blendMode、color、opacity、angle、distance、size、spread。

- [x] **Step 4: 运行测试并确认通过**

Run: `npm test`
Expected: Drop Shadow 编码测试 PASS。

### Task 4: 集成验证

**Files:**
- Modify: `test/frame10-image-verify.ts`（仅在需要固定 effect fixture 时）

- [x] **Step 1: 运行全量测试与构建**

Run: `npm test`
Expected: PASS。

Run: `npm run build`
Expected: PASS。

- [x] **Step 2: 生成并用 libpag 验证 PAG**

Run: 生成包含 Tag 60/65 的 `/tmp/pag-effects.pag`，链接 `build_libpag/libpag.a` 调用 `PAGFile::Load()`。
Expected: 返回非空 PAGFile，并读出 `100x100` 合成尺寸。

- [x] **Step 3: 检查工作区与变更范围**

Run: `git diff --check`
Expected: 无输出。

Run: `git status --short`
Expected: 仅出现本功能计划、源码和测试文件。
