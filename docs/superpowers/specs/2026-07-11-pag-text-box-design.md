# PAG 文本 / 点文本与框文本 — 设计

**状态：** 已实现  
**范围：** 仅 `.pag` 导出。PAGX 本迭代不改。

## 背景

AE / PAG 文本分两种（官方文档原文要点）：

| | 点文本 | 框文本 |
|--|--------|--------|
| 换行 | 不自动换行 | 自动换行 |
| PAG 与 AE | **完全一致** | 可能不一致 |

框文本 PAG **额外规则**（与 AE/Figma 顶对齐冲突的根源）：

1. **高度不够 → 自动缩小字号**，塞进框内  
2. **高度大于行数 → 强制垂直居中**

官方建议：

- 不需要自动换行 → **点文本**
- 需要换行且接受垂直居中 → **框文本**
- 需要换行但不要垂直居中 → 框高收到「刚好放下」临界点；或点文本 + 手动 `\n`

当前导出写死 `boxText: false`，但未正确处理点文本的层变换（中心锚点 AABB），也未映射对齐/行距/字距。

## 设计决策（修订）

### D1. 按是否需要软换行选择点/框（对齐官方）

| Figma `textAutoResize` | PAG | 理由 |
|------------------------|-----|------|
| `WIDTH_AND_HEIGHT` | **点文本** `boxText=false` | 不软换行；排版与 PAG 点文本一致 |
| `HEIGHT` | **框文本** `boxText=true` | 定宽软换行；框高≈内容高，接近「临界高度」，减轻垂直居中 |
| `NONE` | **框文本** | 固定框软换行；接受 PAG 缩字号/垂直居中，或见 D3 |
| `TRUNCATE` | **框文本** + warning | 高度外裁切依赖运行时 |

**撤回**「一律框文本」：会把大量「不需换行」的 Figma 文本拖进缩字号 + 强制居中。

### D2. 坐标系

**框文本**（与 Shape 同构）：

| 字段 | 值 |
|------|-----|
| `boxTextPos` | `{0, 0}` |
| `boxTextSize` | `{width, height}` 节点 AABB |
| `firstBaseLine` | `fontSize * 0.8` |
| Layer Transform | 保持现有：锚点中心、position = 节点中心 |

**点文本**（对齐 AE：基线钉在层原点）：

| 字段 | 值 |
|------|-----|
| `boxText` | `false` |
| `boxTextPos/Size` | `{0,0}` |
| `firstBaseLine` | `0`（运行时对点文本忽略该字段，基线在层 y=0） |
| Layer Transform | **专用**：见下 |

点文本 Transform（相对父）：

```
baselineY ≈ top + fontSize * 0.8   // 无 metrics 时的启发式
LEFT:   anchor=(0, 0),           position=(left, baselineY)
CENTER: anchor=(0, 0),           position=(left + width/2, baselineY)
RIGHT:  anchor=(0, 0),           position=(left + width, baselineY)
```

说明：PAG 点文本在空 `boxRect` 下按 justification 把行画在原点左右；position 应对准 Figma 对齐轴与基线，而不是 AABB 中心。

### D3. 框文本垂直对齐 / 缩字号

| 场景 | 策略 |
|------|------|
| `HEIGHT`（框高≈内容） | 默认导出；通常接近官方「临界高度」 |
| `NONE` + `textAlignVertical=TOP` + 框内有多余高度 | `warning`：PAG 会垂直居中；文档提示可改 `HEIGHT` 或接受居中 |
| `NONE` + `CENTER` | 与 PAG 强制居中一致，无 warning |
| `BOTTOM` | warning（PAG 无底对齐） |
| 框高不够 | 不在导出侧预缩字号；交给 PAG 运行时（官方行为） |

不做：Text Animator、Path、竖排、逐字样式。

### D4. 对齐 / 行距 / 字距

同前一版：LEFT/CENTER/RIGHT/JUSTIFIED → ParagraphJustification；leading/tracking 映射不变。

### D5. 编码

`writeTextDocument` 已支持字段；补全 `ParagraphJustification` 枚举 3–6。

## 关键接口

```typescript
// src/export/pag/text-document.ts

export type TextLayoutMode = 'point' | 'box';

export function textLayoutMode(node: TextNode): TextLayoutMode;
// WIDTH_AND_HEIGHT → point；其余 → box

export function buildTextDocument(
  node: TextNode,
  size: { width: number; height: number },
  diagnostics: Diagnostic[],
  fillColor?: PagColor,
): PagTextDocument;

/** 点文本专用锚点/位置；框文本返回 null（走默认 layerBase） */
export function pointTextTransformOverride(
  node: TextNode,
  parent: SceneNode | null,
  size: { width: number; height: number },
): { anchor: PagPoint; position: PagPoint } | null;

export function justificationFromAlign(...): ParagraphJustification;
export function leadingFromLineHeight(...): number;
export function trackingFromLetterSpacing(...): number;
export function estimateFirstBaseLine(fontSize: number): number;
```

## 伪代码

```
function textLayoutMode(node):
  if node.textAutoResize == WIDTH_AND_HEIGHT: return 'point'
  return 'box'

function buildTextDocument(node, size, diagnostics, fill):
  mode ← textLayoutMode(node)
  if mode == 'box' and textAlignVertical == TOP and textAutoResize == NONE:
    warn TEXT_BOX_VERTICAL_CENTER  // 引用官方规则
  if mode == 'box' and textAlignVertical == BOTTOM:
    warn TEXT_VERTICAL_ALIGN

  doc ← { ...font/fill/align/leading/tracking, text }
  if mode == 'point':
    doc.boxText = false
    doc.boxTextPos/Size = 0
    doc.firstBaseLine = 0
  else:
    doc.boxText = true
    doc.boxTextPos = {0,0}
    doc.boxTextSize = size
    doc.firstBaseLine = estimateFirstBaseLine(fontSize)
  return doc

function mapTextLayer(node, parent, ctx):
  size ← resolvedSize(node)
  base ← layerBase(node, parent, size...)  // 默认中心锚点
  if textLayoutMode(node) == 'point':
    override ← pointTextTransformOverride(...)
    base.transform.anchorPoint = static(override.anchor)
    base.transform.position = static(override.position)  // 无 motion 时；有 motion 另议
  sourceText ← buildTextDocument(...)
  return Text layer
```

## 验收

1. 单测：`WIDTH_AND_HEIGHT` → `boxText=false`；`NONE`/`HEIGHT` → `boxText=true` + size  
2. 单测：点文本 position 落在基线启发式位置  
3. 手工：点文本单行 vs 框文本多行，对照 [官方规则](https://pag.io/docs/editable-text.html) 与 PAGViewer  
4. `npm test` 回归

## 参考

- [Text Editing Rules · PAG](https://pag.io/docs/editable-text.html)
- `libpag`：`TextRenderer::CreateTextLayout` / `AdjustToFitBox`
- AE 导出：`GetTextDocument.js` → `boxText` 字段直通
