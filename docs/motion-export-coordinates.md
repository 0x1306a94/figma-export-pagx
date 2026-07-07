# Motion 动画导出坐标与 Matrix 修正

本文总结 Figma Motion 导出 PAGX 动画时的坐标系、静态布局与 matrix 通道规则。

样例数据见 [built-in-animations.md](./built-in-animations.md)，以及 `test_dev_export_samples/` 下的 `Frame 4.json`、`Frame 6.json`。

## 核心模型

PAGX 层由两部分组成：

```
最终画面 = 静态 Layer（left/top + 可选静态 matrix）
         + 动画 matrix / alpha 通道（相对静止位的增量）
```

**坐标基准始终是编辑态（设计态）下的父节点 local 坐标**，不是 Motion 模式里的 Transform Position / center。

> **说明**：`node.animations`、`animationStyles` 在编辑态与 Motion 模式下内容一致（仅 `id` 可能不同）。「编辑态 / Motion 预览」之分只影响**静态布局**（`left/top`、bbox），不影响动画通道采样。

| 来源 | 示例 | 说明 |
|------|------|------|
| 编辑态 Position | x=49, y=159 | 写入 Layer `left/top` |
| Motion baseValue | TRANSLATION_X baseValue=831 | 理解 Figma 数据用，**不直接写入 PAGX** |
| 节点静止旋转 | ROTATION baseValue=180 | 由静态 Layer `matrix` 表达，**不参与动画增量** |

## 平移（TRANSLATION）

### OFFSET（内置 preset，如 slide_in）

Figma 语义：

```
实际平移 = baseValue - offsetKeyframe
动画增量（相对静止）= -offsetKeyframe   （静止时 offset = 0）
```

示例：`slide_in direction.left distance=200`，首帧 offset = -200，末帧 offset = 0。

导出到 PAGX matrix 时需做坐标转换，且 **X / Y 策略不同**：

| 轴 | 规则 |
|----|------|
| **X** | 节点离父 Frame **右边缘更近**（或水平约束为 MAX）时，对 offset **取反**；否则保留原值 |
| **Y** | **不取反**，保留 Figma offset 原值 |
| **SET** | 始终 `-x / -y`（`figmaRawTranslationToPagx`） |

X 轴示例（节点靠右，offset 取反）：

| 阶段 | Figma offset X | PAGX matrix tx |
|------|----------------|----------------|
| 起点 | -200 | +200 |
| 终点 | 0 | 0 |

Y 轴示例（`slide_in bottom`，offset 不取反）：

| 阶段 | Figma offset Y | PAGX matrix ty |
|------|----------------|----------------|
| 起点 | +20 | +20 |
| 终点 | 0 | 0 |

### SET（手动 keyframe，如 TRANSLATION_XY）

关键帧为 Figma Motion 空间下的**绝对平移**。导出时：

1. 每个分量做 `pagx = -figma`
2. 相对**首帧**求增量：`matrix(t) = pagx(t) - pagx(firstKeyframe)`

示例：首帧 `(0, 0)`，末帧 `(-453, 76)`

| 阶段 | Figma SET | PAGX matrix（相对首帧） |
|------|-----------|------------------------|
| 起点 | (0, 0) | (0, 0) |
| 终点 | (-453, 76) | (453, -76) |

## 旋转（ROTATION）

旋转与平移不同：**只有旋转通道做角度符号修正**；scale / opacity 保持 Figma 原值。

### 方向解析

| preset type | 方向来源 |
|-------------|----------|
| `rotateIn` / `rotateOut` | `props.direction`（`clockwise` / `counterClockwise`） |
| `custom` | `end > start` → 顺时针；`end < start` → 逆时针 |
| 手动 SET（无 style） | 无 direction，仅靠增量 + 取反 |

方向经 `applyRotationDirection()` 规范符号后，再经 `figmaRotationDegreesToPagx()` 决定是否取反：

| 场景 | 是否取反 |
|------|----------|
| `rotateIn` | **总是取反**（与 clockwise / counterclockwise 无关） |
| `rotateOut` | 仅 `counterclockwise` 时取反 |
| `custom` | 仅 `counterclockwise` 时取反 |
| 手动 SET | **总是取反** |

示例：

| 场景 | Figma 数据 | 导出角度 |
|------|-----------|----------|
| rotateIn + CCW，offset -60→0 | directed -60 | +60 |
| rotateIn + CW，offset +360→0 | directed +360 | -360 |
| rotateOut + CW，offset 0→-360 | directed +360 | +360（不取反） |
| 手动 SET，0→-180→0 | 相对首帧 -180 | +180 |

### OFFSET 与 SET 的基准

- **OFFSET**：offset 关键帧本身就是相对静止位的增量；`rotationBase = 0`，**不使用** binding `baseValue`（静止角由静态 Layer matrix 承担）。
- **SET**：相对**最早 SET 关键帧**求增量（`readSetRotationOrigin`）；若 `t=0` 已有 SET 关键帧，**不再**把 `baseValue` 注入采样，避免覆盖首帧。

### 整圈旋转与逐帧烘焙

`rotateIn/Out 360°` 等动画起止 matrix 可能相同（均为 identity）。仅采样起止两帧会被去重成 1 个 key，看不到中间旋转。

当前规则（`shouldBakeMatrixPerFrame`）：

| 场景 | matrix 采样策略 |
|------|----------------|
| 单一平移 preset（如 slide_in） | 仅在 Figma 关键帧时刻采样（通常 2 个 key） |
| 多 preset 组合（position + scale + rotation） | 在 preset 时长内逐帧烘焙（含 easing） |
| 仅有旋转动画 | 逐帧烘焙至最后关键帧时刻 |

烘焙上界为各通道关键帧的 `max(timelinePosition)`，不是整条 timeline 的 `timelineDuration`。

## 缩放（SCALE）

`SCALE_X/Y` 与 `SCALE` 轨道的值**不做**平移/旋转式坐标取反，直接写入 matrix。

注意：`SCALE` 轨道**不注入** `baseValue` 采样点，避免把 `scaleIn 0→1` 错误覆盖为 `1→1`。

## Matrix 组合顺序

当 `animationStyles` 非空时，从 style 列表解析变换顺序（忽略 opacity）：

```
Position → Scale → Rotation
```

对应 `motion.preset_name.position` / `scale` / `rotation`（或 `slide_in`、`scaleIn`、`rotateIn` 等 type）。

连乘方式：`M = R × S × T`（与 Figma 时间线从上到下一致）。Opacity 走独立 `alpha` 通道，不参与 matrix。

无 `animationStyles` 时（纯手动 keyframe），按实际有动画的通道 fallback 为 `translation → scale → rotation`。

## 静态布局（left/top）

`motionLayoutPositionForExport()` 决定带动画节点的静态 `left/top`。

### 编辑态导出

Motion 预览未施加到 bbox 时，`bbox ≈ node.x/y`，直接使用 `layoutPositionAttrs`。静态位置对应**动画起点**。

### Motion 预览停在结束帧

预览时 `absoluteBoundingBox` 已是结束位置，但 `node.x/y` 仍为编辑态起点：

```
shift = bbox - node.x/y ≈ pagxTranslationSpan
```

若 `shift ≈ span`，静态布局回退为 `node.x/y`（起点），matrix 从 0 走到末帧增量，合成后与 Figma 结束帧一致。

### 勿无条件 bbox - span

曾用 `bbox - span` 无条件回推起点；若 span 未做 PAGX 转换（尤其 OFFSET 节点），会导致**多个兄弟节点一起错位**。当前仅在 `shift ≈ span` 时回退。

## 常见现象对照

| 现象 | 可能原因 |
|------|---------|
| slide_in 左右方向反了 | X 轴 offset 取反启发式与节点边距不匹配 |
| slide_in bottom 上下方向反了 | Y 轴 offset 被错误取反（当前 Y 不取反） |
| 手动平移方向反了 | SET 未做 `-x/-y`，或未相对首帧求增量 |
| rotateIn 方向反了 | 未对 rotateIn 做角度取反 |
| rotateOut CW 方向反了 | 误用 rotateIn 取反规则；CW 的 rotateOut 不取反 |
| 整圈旋转看不到过程 | 起止 matrix 相同，需逐帧烘焙 |
| 手动旋转 SET 方向反了 / 幅度错 | `baseValue` 覆盖首帧，或未相对首 SET 关键帧求增量 |
| 组合动画中间帧不对 | 多通道不能用 2-key matrix 线性插值，需逐帧烘焙 |
| scaleIn 无效 | SCALE 轨道被 baseValue 覆盖为 1→1 |

## 导出建议

1. 动画 keyframe 数据与编辑态 / Motion 模式**无关**，无需为此切换模式。
2. 静态 `left/top` 依赖 `absoluteBoundingBox`；预览停在中途帧时可能偏移，起止帧或编辑态导出更稳。
3. 导出后用 `pagx verify --render` 对比 Figma 起止帧与中间帧。
4. 调试：插件 UI「动画数据」面板，或日志 `collectMotionDebugData` 输出。

## 代码入口

| 函数 / 模块 | 职责 |
|-------------|------|
| `figmaOffsetValueToPagx` / `shouldNegateOffsetForAxis` | X 轴 OFFSET 按边距/约束决定是否取反；Y 不取反 |
| `figmaRawTranslationToPagx` | SET 平移 `-x/-y` |
| `readSetTranslationOrigin` | SET 平移相对首帧 |
| `resolveRotationDirection` / `readRotationDirectionFromProps` | 解析旋转方向（含 custom start/end） |
| `applyRotationDirection` | 按 direction 规范角度符号 |
| `figmaRotationDegreesToPagx` / `shouldNegateRotationDegrees` | 按 preset 类型与方向决定是否取反 |
| `readSetRotationOrigin` | SET 旋转相对首帧 |
| `resolveRotationBase` | 动画增量基准恒为 0 |
| `shouldBakeMatrixPerFrame` / `buildMatrixSampleTimes` | 决定 2-key 或逐帧烘焙 |
| `composeAffineMatrixFromTransformOrder` | 按 animationStyles 顺序组合 matrix |
| `buildMatrixChannel` | matrix 通道主入口 |
| `motionLayoutPositionForExport` | 静态 left/top |
| `collectFloatSamples` | 采样；SET 在 t=0 有关键帧时不注入 base |

## 尚未覆盖

- timeline 当前播放时间 API（目前靠 bbox / node.x 差值推断预览状态）
- 变量 easing、弹簧等的完整还原（见 diagnostics 警告）
- 非 SET / OFFSET / SCALE 的 keyframeOperation
- WIDTH / HEIGHT 尺寸动画与 transform 强耦合时的通用 pivot 补偿
