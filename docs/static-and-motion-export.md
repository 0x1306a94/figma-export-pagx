# PAGX 静态与 Motion 动画导出说明

本文记录当前 Figma 到 PAGX 导出的静态布局、旋转、翻转、Motion 动画和调试规则。示例可参考 `test_dev_export_samples/Frame7-no-rotation.pagx`、`test_dev_export_samples/Frame7-rotation.pagx`、`test_dev_export_samples/Frame4.pagx`、`test_dev_export_samples/Frame6.pagx`。

## 目标

导出的 PAGX 应先保证 Figma 编辑态的静态画面一致，再在这个静态状态上叠加 Motion 动画。

基本原则：

```text
静态位置 = Layer 的 left/top/width/height
静态旋转/翻转 = 仅在确实存在旋转、翻转或非零补偿时写 Layer matrix
Motion transform 动画 = 优先写内部 Group 的 position/rotation/scale 通道
Opacity 动画 = 写 Layer 的 alpha 通道
没有动画数据 = 不输出 <Animations>
```

## 静态导出

### 不旋转节点

没有旋转、翻转、非零 matrix 补偿时，不给 Layer 写 `matrix`。

这类节点只依赖：

```xml
<Layer left="..." top="..." width="..." height="...">
```

原因是 PAGX 的 `left/top/width/height` 已能表达 Figma 属性面板中的静态矩形。如果额外写入来自父级坐标差异的 pure flip matrix，PAGX 渲染会出现 X/Y 被翻转的问题。

对应实现：


| 代码                            | 职责                                         |
| ----------------------------- | ------------------------------------------ |
| `nodePositionInParent()`      | 计算 Layer 的 `left/top`                      |
| `nodeMatrixInParent()`        | 只在本地 transform 非 identity 或有非零补偿时输出 matrix |
| `staticLayerMatrixInParent()` | 静态 Layer matrix 的出口                        |




### 旋转节点

有静态旋转时仍需要写 Layer `matrix`，因为 Layer 本身没有 `rotation` 标量属性。

当前规则：

1. 先计算节点相对父级的本地 transform。
2. `left/top` 仍使用布局位置。
3. matrix 的 `tx/ty` 写成 `transformX - layout.left`、`transformY - layout.top`，避免把布局位移重复写进 matrix。
4. 如果最终 matrix 是 identity 且 `tx/ty` 为 0，则省略 matrix。

这保证 `Frame7-rotation.pagx` 中的旋转矩形与 Figma 编辑态位置、旋转方向一致。

### 父级翻转

Frame 或 Group 出现父级坐标翻转时，不能把 pure flip 无条件写到每个子 Layer。静态导出的目标是视觉结果与 Figma 编辑态一致，而不是复刻 Figma 内部绝对矩阵。

因此：

- 普通未旋转子节点不写 matrix。
- 确实有旋转/翻转的子节点才写 matrix。
- 动画方向判断会额外考虑父级 pure flip，避免 Motion 位移方向反掉。



## Motion 动画导出



### 入口

`mapFigmaToPagx()` 会在静态 Layer 映射完成后调用：

```ts
collectMotionAnimations(root, layerIdByFigmaId, motionTargetIdByFigmaId, diagnostics)
```

如果没有任何有效动画对象，返回空数组，writer 不输出 `<Animations>`。

PAGX 动画基础参数：


| 字段          | 当前值                       |
| ----------- | ------------------------- |
| `id`        | `motion-main`             |
| `frameRate` | `60`                      |
| `loop`      | `once`                    |
| `duration`  | 根据 Figma timeline 秒数换算为帧数 |




### Target 分配

当前导出会把动画拆到不同 target：


| Figma 动画             | PAGX target | PAGX channel                |
| -------------------- | ----------- | --------------------------- |
| `OPACITY`            | 原 Layer     | `alpha`                     |
| `TRANSLATION_X/Y/XY` | 内部 Group    | `position.x` / `position.y` |
| `ROTATION`           | 内部 Group    | `rotation`                  |
| `SCALE_X/Y/XY`       | 内部 Group    | `scale.x` / `scale.y`       |
| 不适合 Group 的 fallback | 原 Layer     | `matrix`                    |


这样做的原因是 PAGX 的 `Layer` 支持 `matrix` 和 `alpha`，但不支持标量 `rotation` / `scale`；`Group` 支持 `anchor`、`position`、`rotation`、`scale`，更适合表达绕自身中心的 Motion transform。

## 内部 Group 方案

带 transform 动画的几何节点会被包一层内部 Group：

```xml
<Layer left="..." top="..." width="..." height="...">
  <Group
    id="motion_group..."
    name="Rectangle Motion"
    anchor="width/2,height/2"
    position="width/2,height/2"
    width="..."
    height="..."
  >
    <Rectangle width="..." height="..."/>
    <Fill color="..."/>
  </Group>
</Layer>
```

对应实现：


| 代码                              | 职责                                    |
| ------------------------------- | ------------------------------------- |
| `needsMotionTransformGroup()`   | 判断节点是否有 transform 动画                  |
| `wrapContentsInMotionGroup()`   | 生成内部 Group，并设置中心 anchor/position      |
| `motionTargetIdByFigmaId`       | 记录 Figma 节点到内部 Group id 的映射           |
| `buildGroupTransformChannels()` | 生成 Group 的 position/rotation/scale 动画 |




### 为什么不继续预烘焙 matrix

早期做法会把旋转/缩放/组合 transform 预烘焙成 `matrix` keyframe。问题是：

1. matrix 线性插值不能稳定表达整圈旋转。
2. 仅起止两帧时，`0deg` 和 `360deg` 的 matrix 相同，会丢失旋转过程。
3. 绕自身中心旋转需要 pivot 补偿，matrix keyframe 很容易变成绕错误位置旋转。
4. PAGX 本身支持 easing，过度烘焙会丢掉原始关键帧语义，也让文件变大。

现在优先使用 Group 的标量通道，保留 Figma keyframe 和 easing。只有没有内部 Group target 时才 fallback 到 matrix。

## 坐标规则



### 静态布局

`motionLayoutPositionForExport()` 会优先保持 Figma 编辑态坐标。

如果 Figma Motion 预览停在结束帧，`absoluteBoundingBox` 可能已经被预览位移影响，但 `node.x/y` 仍是编辑态位置。此时会判断：

```text
bbox.left - node.x ~= PAGX translation span.x
bbox.top  - node.y ~= PAGX translation span.y
```

命中时使用 `node.x/y` 作为静态 `left/top`，避免把结束帧位置错误写成静态位置。

### 平移动画

Figma Motion 的平移有两类：


| 类型       | 含义                       | PAGX 处理                               |
| -------- | ------------------------ | ------------------------------------- |
| `OFFSET` | 相对静止位置的偏移，常见于内置 preset   | 按 Figma offset 和方向规则转成 Group position |
| `SET`    | 手动 keyframe 的绝对 Motion 值 | 相对首个 SET 关键帧求增量                       |


写入 Group 时，位置通道以 Group 初始中心为基准：

```text
position.x = width / 2 + translationX - setOriginX
position.y = height / 2 + translationY - setOriginY
```

其中 `setOriginX/Y` 只用于 SET 手动 keyframe，让第一帧保持静态状态。

### X/Y 翻转方向

`slide_in` 等 OFFSET 动画在 Figma 与 PAGX 坐标里存在方向差异。当前规则：

- X 轴会根据节点与父级边缘关系、约束、父级 pure flip 判断是否取反。
- Y 轴不做同样的边距启发式取反。
- 当父级存在 pure XY flip 时，会优先修正 X 轴方向，避免 `Rectangle17` 这类动画从左往右/从右往左反掉。



### 旋转动画

Group 的 `rotation` 通道使用角度标量，并保留 easing。

旋转处理分两步：

1. `applyRotationDirection()` 根据 preset direction 或 custom start/end 规范旋转方向。
2. `figmaRotationDegreesToPagx()` 按 PAGX 坐标方向转换角度。

常见规则：


| 场景              | 当前处理                                         |
| --------------- | -------------------------------------------- |
| `rotateIn`      | 角度方向需要转换，保证与 Figma 预览一致                      |
| `rotateOut`     | 根据 clockwise / counterClockwise 判断           |
| 手动 SET rotation | 相对首个 SET keyframe 求增量                        |
| 静态已旋转节点         | 静态旋转由 Layer matrix 表达，Motion rotation 表达动画增量 |




### 缩放动画

`SCALE_X`、`SCALE_Y`、`SCALE_XY` 会写入 Group 的 `scale.x`、`scale.y`。



## Easing

Figma keyframe 的 easing 会映射到 PAGX keyframe：

- linear easing 不额外写 interpolation。
- cubic bezier 会写 `interpolation` 和 bezier 控制点。
- 不支持或无法完整还原的 easing 会通过 diagnostics 给 warning。

由于 transform 动画现在优先写标量 channel，不需要为了 easing 逐帧烘焙 matrix。

## Writer 输出规则

`pagx-writer.ts` 当前支持：

```xml
<Animations>
  <Animation id="motion-main" duration="..." frameRate="60" loop="once">
    <Object target="...">
      <Channel name="position.x" type="float">
        <Key time="..." value="..." />
      </Channel>
    </Object>
  </Animation>
</Animations>
```

以及内部 Group：

```xml
<Group id="..." anchor="..." position="..." width="..." height="...">
  ...
</Group>
```

当 `document.animations` 为空时，`writeAnimations()` 返回空字符串，不写 `<Animations>`。

## Motion debug JSON

Motion debug JSON 保留，不要删除。

用途：

1. 对照 Figma MCP 读取到的 `animations`、`animationStyles`、`timelines`。
2. 排查 keyframeOperation、baseValue、timelinePosition 是否符合预期。
3. 对比内置 preset 与手动 keyframe 的差异。

测试中看到的日志来自 `logMotionDebugData()`，这是有意保留的调试信息。

## 样例对照



### Frame7-no-rotation

预期：

- 所有未旋转矩形只写 `left/top/width/height`。
- 不应因为父级坐标差异给每个 Layer 写 matrix。
- PAGX 渲染结果与 Figma 编辑态位置一致，不出现 X/Y flip。



### Frame7-rotation

预期：

- 未旋转节点仍不写 matrix。
- `Rectangle17` 的静态旋转由 Layer matrix 表达。
- 旋转方向与 Figma 一致。



### Frame4

预期：

- `Rectangle17` 这类 position preset 方向与 Figma 一致。
- `Rectangle20` / `Rectangle23` 的 rotation/scale 不再预烘焙为大量 matrix keyframe。
- transform 动画写到内部 Group，绕自身中心旋转。
- timeline 与 easing 尽量保留。



### Frame6

预期：

- `SCALE` operation 不再被误报为不支持。
- 没有有效动画数据的节点不会生成空动画对象。



## 常见问题


| 现象                   | 排查方向                                                          |
| -------------------- | ------------------------------------------------------------- |
| 静态节点整体 X/Y flip      | 检查未旋转 Layer 是否错误写了 matrix                                     |
| 静态旋转方向反了             | 检查 `nodeMatrixInParent()` 的相对父级 transform 和 `b/c` 符号          |
| Motion 平移方向反了        | 检查 OFFSET 的 X 轴取反规则、父级 pure flip 判断                           |
| 旋转不是绕自身中心            | 检查是否生成内部 Group，且 `anchor` / `position` 是否为 `width/2,height/2` |
| 旋转像左右摇摆              | 检查是否 fallback 到 matrix 线性插值；应优先使用 Group `rotation`            |
| 文件里有空 `<Animations>` | `collectMotionAnimations()` 应返回 `[]`，writer 会跳过输出             |
| SCALE 轨道报警           | 检查 `collectSetTrackWarnings()` 是否把 `SCALE` 作为支持 operation     |




## 主要代码入口


| 文件                            | 入口                              | 说明                             |
| ----------------------------- | ------------------------------- | ------------------------------ |
| `src/export/figma-to-pagx.ts` | `mapFigmaToPagx()`              | 总入口，创建 document、收集动画           |
| `src/export/figma-to-pagx.ts` | `mapNode()`                     | Figma 节点映射为 PAGX Layer         |
| `src/export/figma-to-pagx.ts` | `wrapContentsInMotionGroup()`   | 给 transform 动画几何节点加内部 Group    |
| `src/export/figma-reader.ts`  | `nodePositionInParent()`        | 静态布局位置                         |
| `src/export/figma-reader.ts`  | `nodeMatrixInParent()`          | 静态 matrix                      |
| `src/export/figma-motion.ts`  | `collectMotionAnimations()`     | Motion 动画收集                    |
| `src/export/figma-motion.ts`  | `buildGroupTransformChannels()` | Group 标量 transform 动画          |
| `src/export/figma-motion.ts`  | `buildMatrixChannel()`          | fallback matrix 动画             |
| `src/export/pagx-writer.ts`   | `writeElement()`                | 写 Group / Rectangle / Text 等元素 |
| `src/export/pagx-writer.ts`   | `writeAnimations()`             | 写 `<Animations>`，空数组时跳过        |




## 验证建议

修改静态或动画导出后至少运行：

```bash
npm test
```

需要人工看渲染时，再用：

```bash
npm run build
build_libpag/pagx verify test_dev_export_samples/Frame4.pagx --render
build_libpag/pagx verify test_dev_export_samples/Frame7-rotation.pagx --render
```

如果 `build_libpag/pagx` 不存在，按项目 `AGENTS.md` 中的 libpag CLI 编译流程准备。