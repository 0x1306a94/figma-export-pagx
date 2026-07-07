# Motion 动画导出坐标与 Matrix 修正

本文总结 Figma Motion 导出 PAGX 动画时遇到的坐标系、静态布局与 matrix 通道问题，以及当前插件中的处理规则。

原始观测数据与内置 preset 样例见 [built-in-animations.md](./built-in-animations.md)。

## 核心模型

PAGX 层由两部分组成：

```
最终画面 = 静态 Layer（left/top + 可选静态 matrix）
         + 动画 matrix 通道（相对静止位的增量）
```

**坐标基准始终是编辑态（设计态）下的父节点 local 坐标**，而不是 Motion 模式里看到的 Transform Position / center 坐标。

> **说明**：`node.animations`、`animationStyles` 等动画 API 数据在编辑态与 Motion 模式下内容一致（仅节点 `id` 可能不同）。下文「编辑态 / Motion 预览」之分，只影响**静态布局**（`left/top`、bbox），不影响动画通道本身的采样。

| 来源 | 示例 | 说明 |
|------|------|------|
| 编辑态 Position | x=49, y=159 | 写入 Layer `left/top` |
| Motion Transform | x=661 → baseValue=831 | 仅用于理解 Figma 数据，**不直接写入 PAGX** |
| baseValue 与 center | 831 = 661 + 340×0.5 | Motion 平移以 center 为参考 |

## 两类平移轨道

Figma `TRANSLATION_*` 绑定按 `keyframeOperation` 分两种语义，导出时必须区分。

### OFFSET（内置 preset，如 slide_in）

Figma 渲染效果等价于：

```
实际平移 = baseValue - offsetKeyframe
相对静止 = -offsetKeyframe    （静止时 offset = 0）
```

示例：`slide_in direction.left distance=200` 时，首帧 offset = -200，静止 offset = 0。

| 阶段 | Figma offset | PAGX matrix tx（相对静止） |
|------|-------------|---------------------------|
| 起点 | -200 | +200 |
| 终点 | 0 | 0 |

**错误做法**：把 offset 原样写入 matrix（-200 → 0），方向与 Figma 相反。

**正确做法**：`-offset`；静止帧 matrix 为 0，动画从非零回到 0。

内置 preset 方向规律（distance 为正）：

| preset | 视觉效果 |
|--------|---------|
| slide_in + direction.left | 从右往左 |
| slide_in + direction.right | 从左往右 |

### SET（手动 keyframe，如 TRANSLATION_XY）

关键帧值为 Figma Motion 空间下的**绝对平移**；导出时需：

1. **坐标系转换**（见下节）
2. **相对首帧**做增量：`matrix(t) = pagxTranslation(t) - pagxTranslation(firstKeyframe)`

示例：首帧 `(0, 0)`，末帧 `(-453, 76)`（Figma 中为右上方向）

| 阶段 | Figma SET | PAGX matrix（相对首帧） |
|------|-----------|------------------------|
| 起点 | (0, 0) | (0, 0) |
| 终点 | (-453, 76) | (453, -76) |

## Figma Motion → PAGX 坐标转换

Figma Motion 的平移值与 PAGX（Y 轴向下）不一致，统一转换：

```typescript
pagxValue = -figmaValue
// 向量：(pagxX, pagxY) = (-figmaX, -figmaY)
```

实现见 `figmaRawTranslationToPagx()`（`src/export/figma-motion.ts`）。**OFFSET 与 SET 采样均走此转换。**

## 静态布局（left/top）

`motionLayoutPositionForExport()` 决定带动画节点的静态 `left/top`。

### 编辑态导出（静态布局最简）

Motion 预览未施加到 bbox 时，`bbox ≈ node.x/y`，直接使用 `layoutPositionAttrs` 即可。此时静态位置对应**动画起点**（手动 SET 的首帧位置）。

### Motion 预览停在结束帧

预览时 `absoluteBoundingBox` 已是结束位置，但 `node.x/y` 仍为编辑态起点。此时：

```
shift = bbox - node.x/y ≈ pagxTranslationSpan
```

若 shift 与 span 一致，静态布局回退为 `node.x/y`（起点），matrix 动画从 0 走到末帧增量，合成后结束帧与 Figma 一致。

### 曾出现的问题：错误的 bbox - span 回退

在未匹配 preview 条件时，用 `bbox - span` 回推起点。若 span 未做 PAGX 转换（尤其 OFFSET 节点），会算错静态位置，**多个带动画的兄弟节点会一起错位**。

当前规则：**仅**在 `shift ≈ span` 时用 `node.x/y`；否则走正常 `layoutPositionAttrs`，不再无条件 `bbox - span`。

## 常见现象对照

| 现象 | 可能原因 |
|------|---------|
| 内置 slide_in 方向反了 | OFFSET 未取反，用了 raw offset |
| 手动动画方向反了 | 静态层在结束位 + matrix 仍按起点增量，或 span/layout 回推错误 |
| 结束帧整体偏到左下 | SET 未做 `-x/-y` 转换，如 (-453,76) 被当成 PAGX 位移 |
| 多个矩形同时错位 | 错误的 layout 回退影响了多个 OFFSET/SET 节点 |
| 自定义 SET 正常、内置反了 | 仅 OFFSET 路径缺取反（或反之） |

## 导出建议

1. 动画 keyframe 数据与当前处于编辑态还是 Motion 模式**无关**，无需为此切换模式。
2. 静态 `left/top` 依赖 `absoluteBoundingBox`：若在 Motion 预览中停在**中途帧**，bbox 与 `node.x/y` 不一致且不满足 shift ≈ span，静态层可能偏移；起止帧或编辑态下导出更稳。
3. 导出后用 `pagx verify --render` 对比 Figma 起止帧。
4. 调试时可查看插件 UI「动画数据」面板或日志 `[figma-export-pagx] motion debug data`（`collectMotionDebugData` 输出）。

## 代码入口

| 模块 | 职责 |
|------|------|
| `collectFloatSamples` / `collectVectorSamples` | OFFSET 取反、SET 坐标转换 |
| `motionLayoutPositionForExport` | 动画节点静态 left/top |
| `buildMatrixChannel` | SET 相对首帧；采样后写入 matrix 通道 |
| `pagxMotionMatrixStringFromComponents` | 组装 2×3 matrix 字符串 |
| `figma-to-pagx.ts` | Layer 使用 `motionLayoutPositionForExport` |

## 尚未覆盖

- 导出时 timeline 当前时间 API（目前靠 bbox/node.x 差值推断预览状态）
- 旋转/缩放与平移强耦合时的通用 pivot 补偿
- 非 SET/OFFSET 的 keyframeOperation
- 变量 easing、弹簧等（见 diagnostics 警告）
