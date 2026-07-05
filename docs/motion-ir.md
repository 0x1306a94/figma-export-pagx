# Motion IR 设计

本文档描述插件当前生成的 Motion IR。IR 的目标是把 Figma Motion 数据转换成平台无关的中间描述，后续可基于它生成 CoreAnimation、Web Animation、Android 动画等平台代码。

## 设计目标

- 以一个选中的 root 节点作为导出范围。
- 递归读取 root 及其所有子节点。
- 保留节点层级和 root-local 坐标。
- 将 Figma timeline 映射为通用 composition。
- 将 Figma motion track 映射为 clip、track、keyframe。
- 清理无视觉效果的 noop track。
- 不保存完整 Figma raw 数据，只保留必要的 source 追溯字段。

## 导出入口

当前只支持选择一个 root 节点导出。

```txt
选择 1 个 root 节点
  -> 递归收集 root 和所有子节点
  -> 读取每个节点的 animations
  -> 转换为 MotionIr
```

如果选择 0 个或多个节点，返回错误：

```json
{
  "error": "请选择一个父节点作为导出 root"
}
```

## 顶层结构

```ts
type MotionIr = {
  version: '1.0';
  source: {
    tool: 'figma';
    exportedAt: string;
  };
  scene: {
    rootNodeId: string;
    coordinateSpace: 'root-local';
    nodes: IrNode[];
  };
  compositions: IrComposition[];
  diagnostics: IrDiagnostic[];
};
```

字段说明：

- `version`：IR 版本号。
- `source.tool`：当前固定为 `figma`。
- `source.exportedAt`：导出时间。
- `scene.rootNodeId`：导出 root 节点 ID。
- `scene.coordinateSpace`：当前固定为 `root-local`。
- `scene.nodes`：root 和子节点列表。
- `compositions`：由 Figma timeline 归一化得到的动效编排。
- `diagnostics`：导出过程中的提示、警告或错误。

## 节点结构

```ts
type IrNode = {
  id: string;
  name: string;
  type: string;
  parentId?: string;
  children: string[];
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
```

节点坐标使用 root-local 坐标：

```txt
node.bounds.x = node.absoluteBoundingBox.x - root.absoluteBoundingBox.x
node.bounds.y = node.absoluteBoundingBox.y - root.absoluteBoundingBox.y
```

root 节点本身不记录 root 外部的 `parentId`。子节点只在父节点也属于当前导出范围时记录 `parentId`。

## Composition

Figma 的 timeline 会被映射为 IR 的 composition。

```ts
type IrComposition = {
  id: string;
  sourceTimelineId: string;
  duration: number;
  clips: IrClip[];
};
```

字段说明：

- `id`：当前使用 Figma timeline id。
- `sourceTimelineId`：Figma 原始 timeline id。
- `duration`：归一化后 composition 的持续时间。
- `clips`：该 timeline 下的动画片段。

## Clip

Clip 表示某个节点上的一个动画片段。多个属性来自同一个 animation style、同一个节点、同一个 timelineOffset 和 duration 时，会合并到同一个 clip。

```ts
type IrClip = {
  id: string;
  targetNodeId: string;
  startTime: number;
  duration: number;
  tracks: IrTrack[];
  source: {
    timelineOffset: number;
    animationStyleId?: string;
    animationStyleName?: string;
  };
};
```

字段说明：

- `id`：优先使用 animation style id，没有时生成内部 id。
- `targetNodeId`：clip 作用的节点。
- `startTime`：在当前 composition 中的归一化开始时间。
- `duration`：clip 持续时间。
- `tracks`：该 clip 内的属性动画轨道。
- `source.timelineOffset`：Figma 原始 timelineOffset。
- `source.animationStyleId`：Figma animation style 实例 id。
- `source.animationStyleName`：Figma animation style 名称。

## Timeline Offset 归一化

Figma 的 `timelineOffset` 是原始 timeline 上的位置。IR 中的 `clip.startTime` 会重新归一化，让导出的 composition 从 `0` 开始。

```txt
compositionStartTime = min(all clip source.timelineOffset)
clip.startTime = source.timelineOffset - compositionStartTime
```

示例：

```txt
Figma timelineOffset: 2.0, 2.5, 3.0
IR startTime:        0.0, 0.5, 1.0
```

这样生成平台动画时，不会带着导出范围之前的空白时间。

## Track

Track 表示一个属性随时间变化。

```ts
type IrTrack = {
  property: IrProperty;
  operation: 'absolute' | 'relative' | 'scale';
  baseValue?: number;
  keyframes: IrKeyframe[];
  source: {
    property: KeyframePropertyFieldName;
    trackId: string;
  };
};
```

字段说明：

- `property`：平台无关属性名。
- `operation`：由 Figma `keyframeOperation` 映射得到。
- `baseValue`：Figma binding 的基础值。
- `keyframes`：关键帧列表。
- `source.property`：Figma 原始属性名。
- `source.trackId`：Figma 原始 track id。

当前支持的属性映射：

| Figma 属性 | IR 属性 |
| --- | --- |
| `TRANSLATION_X` | `translation.x` |
| `TRANSLATION_Y` | `translation.y` |
| `OPACITY` | `opacity` |
| `ROTATION` | `rotation` |
| `SCALE_X` | `scale.x` |
| `SCALE_Y` | `scale.y` |
| `WIDTH` | `size.width` |
| `HEIGHT` | `size.height` |

当前支持的 operation 映射：

| Figma operation | IR operation |
| --- | --- |
| `SET` | `absolute` |
| `OFFSET` | `relative` |
| `SCALE` | `scale` |

## Keyframe

```ts
type IrKeyframe = {
  time: number;
  value: number;
  easing?: IrEasing;
};
```

字段说明：

- `time`：clip 内部时间，保留 Figma keyframe 的 `timelinePosition`。
- `value`：关键帧数值。当前只支持 Figma `FLOAT` 类型。
- `easing`：归一化后的 easing。

注意：keyframe 的 `time` 不会展开成 composition 绝对时间。clip 的开始时间由 `clip.startTime` 表达。

## Easing

```ts
type IrEasing =
  | { type: 'linear' }
  | { type: 'figma'; name: string }
  | { type: 'cubicBezier'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'spring'; bounce: number };
```

映射规则：

- `LINEAR` -> `{ type: 'linear' }`
- `CUSTOM_CUBIC_BEZIER` -> `{ type: 'cubicBezier', ... }`
- `CUSTOM_SPRING` -> `{ type: 'spring', bounce }`
- 其他 Figma easing -> `{ type: 'figma', name }`
- variable alias easing 暂不导出，返回 `undefined`

## Noop Track 清理

IR 会忽略没有视觉变化的 track，并记录 `diagnostics`。

当前规则：

```txt
relative track:
  所有 keyframe value 相同，并且值为 0 -> 忽略

absolute track:
  所有 keyframe value 相同，并且等于 baseValue -> 忽略

scale track:
  所有 keyframe value 相同，并且值为 1 -> 忽略
```

例如 `TRANSLATION_Y: 0 -> 0` 会被忽略。

对应诊断：

```json
{
  "level": "info",
  "code": "NOOP_TRACK_IGNORED",
  "message": "忽略无变化轨道 TRANSLATION_Y"
}
```

## Diagnostics

```ts
type IrDiagnostic = {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  nodeId?: string;
  property?: string;
  sourceTrackId?: string;
};
```

当前会产生的诊断：

| code | level | 含义 |
| --- | --- | --- |
| `NOOP_TRACK_IGNORED` | `info` | 忽略无视觉变化的 track |
| `UNSUPPORTED_PROPERTY` | `warning` | 暂不支持该 Figma motion 属性 |
| `UNSUPPORTED_KEYFRAME_VALUE` | `warning` | 暂不支持非数字关键帧值 |

## 当前限制

- 只支持选择一个 root 节点导出。
- 不支持多选节点自动推断共同父节点。
- 不保存完整 Figma raw 数据。
- 当前只支持数字型 keyframe value。
- 暂不导出 fills、strokes、effects 内部属性动画。
- 暂不处理同一节点同一属性的重叠冲突。
- 暂不直接生成平台代码。

## CoreAnimation 映射方向

后续生成 iOS CoreAnimation 时，可以按下面方向映射：

| IR 属性 | CoreAnimation keyPath |
| --- | --- |
| `translation.x` | `transform.translation.x` |
| `translation.y` | `transform.translation.y` |
| `opacity` | `opacity` |
| `rotation` | `transform.rotation.z` |
| `scale.x` | `transform.scale.x` |
| `scale.y` | `transform.scale.y` |
| `size.width` | `bounds.size.width` |
| `size.height` | `bounds.size.height` |

`IrComposition` 可映射为一组 `CAAnimationGroup` 或统一调度容器；`IrClip.startTime` 可映射为动画的 `beginTime`。
