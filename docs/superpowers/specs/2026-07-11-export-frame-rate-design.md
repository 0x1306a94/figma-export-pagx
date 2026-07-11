# 导出帧率可配置 — 设计

**状态：** 已实现  
**范围：** `ui.html`、`src/code.ts`、`src/export/index.ts`、`src/export/figma-motion.ts`、`src/export/figma-to-pagx.ts`、`src/export/pag/figma-to-pag.ts`、相关测试与文档。

## 背景

当前导出帧率写死为 `MOTION_FRAME_RATE = 60`，用于：

- PAGX：`Animation.duration` / `frameRate`，以及秒 ↔ 帧换算、逐帧 bake
- PAG：`VectorComposition.frameRate` 与 motion 采样

静态几何映射不依赖帧率。需要支持导出时指定帧率，默认改为 30。

## 目标

1. 默认帧率改为 **30**。
2. 用户可在面板手动选择 **24 / 30 / 60**（下拉，共用一个控件）。
3. 每次打开面板默认为 30（不持久化：Figma 插件 UI 为 `data:` URL，`localStorage` 不可用）。
4. PAGX 与 PAG 导出共用同一帧率值。
5. 帧率作为导出参数向下传递（方案 1），不用模块级可变全局状态。

## 非目标

- 不支持任意自定义数字输入。
- 不改变 keyframe 以「帧」为单位的语义。
- 不改动静态图层映射算法（fills / strokes / 坐标等）。

## 设计决策

### D1. 数据流（方案 1）

```
ui.html <select>
  → pluginMessage { type: 'export-pagx'|'export-pag', frameRate }
  → code.ts 校验后调用
  → exportPagx(root, { frameRate }) / exportPag(root, { frameRate })
  → collectMotionAnimations(..., frameRate)
     collectPagMotionFrames(..., frameRate)
  → 写出 Animation.frameRate / composition.frameRate
     以及 duration、keyframe time 的秒↔帧换算
```

### D2. UI

- 位置：「导出」分区，两个导出按钮上方。
- 控件：`<select>`，选项 `24` / `30` / `60`，默认选中 `30`。
- **不持久化**：Figma 插件沙盒为 `data:` URL，无法使用 `localStorage`；每次打开面板均为 30。
- 导出 busy 时：下拉 **disabled**（避免误解为会影响进行中的导出）。

### D3. 校验

`code.ts`：

```
allowed = {24, 30, 60}
frameRate = allowed.has(msg.frameRate) ? msg.frameRate : 30
```

非法值静默回落 30，不弹错（UI 已限制档位）。

### D4. 导出 API

```ts
export const MOTION_FRAME_RATE = 30;
export const ALLOWED_FRAME_RATES = [24, 30, 60] as const;

type ExportOptions = { frameRate?: number }; // 缺省 → MOTION_FRAME_RATE

exportPagx(root, options?: ExportOptions)
exportPag(root, options?: ExportOptions)

collectMotionAnimations(..., frameRate = MOTION_FRAME_RATE)
collectPagMotionFrames(..., frameRate = MOTION_FRAME_RATE)
```

- `ExportContext` / `PagExportContext` 增加 `frameRate`。
- `figma-motion.ts` 内所有 `MOTION_FRAME_RATE` 换算改为使用传入的 `frameRate`（经 `collect*` 向下传，或小对象 `MotionTiming`，避免散落常量）。
- `MOTION_FRAME_RATE` 仅作默认值常量，不再是唯一真相源。

### D5. 行为语义

- 墙钟时长不变：同一秒数在 30fps 下 `duration` / keyframe `time` 约为 60fps 的一半。
- 逐帧 bake（旋转 / 多通道 / spring）采样密度随 fps 变化，插值可能略有差异，可接受。
- 无动画的静态 PAGX：通常无 `<Animations>`，帧率选择无可见影响。
- 无动画的静态 PAG：composition 仍写入所选 `frameRate`。

### D6. 测试与文档

- 现有按 60fps 断言帧号的用例：显式传 `{ frameRate: 60 }`，断言保持不变。
- 新增：默认 30 时（如 2s → `duration === 60`，`frameRate === 30`）。
- 更新 `docs/static-and-motion-export.md`、`docs/pag-export-design.md` 中默认 60 的描述。
- `.gitignore` 增加 `.superpowers/`。

## 验收

1. 面板打开时帧率默认为 30。
2. 导出 PAGX / PAG 时，输出中的 `frameRate` 与所选一致；有动画时 duration / keyframe 按该 fps 换算。
3. 既有测试在显式 `frameRate: 60` 下仍通过；默认路径覆盖 30。
4. 非法 `frameRate` 消息回落为 30。
