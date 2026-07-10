# Figma → PAG SolidLayer 设计

日期：2026-07-10  
状态：已实现

## 目标

在 Figma 中用图层命名标记可运行时改色的色块，导出 `.pag` 时写成 `LayerType.Solid`（`PAGSolidLayer`），业务侧可通过 `setSolidColor` 动态改色。对齐 AE Solid → PAG SolidLayer。

## 非目标

- PAGX 不产生 Solid 语义（无 `setSolidColor`）
- 不支持圆角 Solid（PAG Solid 仅 `solidColor + width + height`）
- 不新增特效导出（有特效则忽略，与现有一致）
- 不自动把普通矩形识别为 Solid

## 命名标记

- 前缀：`#solid` / `#Solid`（大小写不敏感，匹配 `/^#solid\b/i`）
- 导出名：去掉前缀及紧随空格  
  - `#solid Brand` → `Brand`  
  - `#solid  Brand` → `Brand`  
  - `#Solid背景` → `背景`（无空格时直接拼接剩余部分）

## 合格条件（仅导出 PAG）

同时满足：

1. 图层名带 `#solid` 前缀
2. 节点为 `RECTANGLE`，或 VECTOR 且可识别为轴对齐**直角**矩形
3. 恰好 1 个可见纯色 Fill（无渐变 / 图片）
4. 无可见描边
5. 无圆角（corner radius = 0）
6. 无 WIDTH / HEIGHT size 动画（Solid 尺寸为静态字段）

特效：有则忽略，不因此失败。

## 失败行为

有 `#solid` 但不满足合格条件 → **抛错，整次导出中断**，UI 显示错误（含节点名与原因）。不降级为 ShapeLayer。

## PAGX

- 不校验 Solid 资格
- 建议去掉 `#solid` 前缀后按普通矩形导出（避免图层名残留标记）

## 数据与编码

### IR

```ts
type PagSolidLayer = PagLayerBase & {
  type: LayerType.Solid; // 2
  solidColor: PagColor;  // RGB
  width: number;
  height: number;
};
```

`PagLayer` 联合类型增加 `PagSolidLayer`。

### 编码

对齐 `libpag/src/codec/tags/SolidColor.cpp`：

```
TagCode.SolidColor (7)
  WriteColor(solidColor)
  writeEncodedInt32(width)
  writeEncodedInt32(height)
```

LayerBlock：`type=Solid` + LayerAttributes + Transform2D + SolidColor + End。

### 透明度

Fill opacity × 节点 opacity → `Transform2D.opacity`；`solidColor` 只写 RGB。

### Motion

- 支持现有 transform / opacity 动画
- size 动画 → 报错中断（见合格条件）

## 映射伪代码

```
parseSolidMarker(name) → { isSolid, exportName }

mapGeometryLayer(node):
  marker = parseSolidMarker(node.name)
  if marker.isSolid:
    assertSolidEligible(node)  // throw on fail
    return PagSolidLayer {
      name: marker.exportName,
      solidColor, width, height,
      transform: buildTransform(...),  // opacity 含 fill opacity
      ...
    }
  // 原 Shape 路径
```

## 运行时用法（文档说明）

```ts
const layers = pagFile.getLayersByName('Brand');
(layers[0] as PAGSolidLayer).setSolidColor({ red, green, blue });
```

## 测试要点

1. `#solid` 直角纯色矩形 → Solid tag，name 无前缀
2. `#solid` + 圆角 / 描边 / 渐变 / size 动画 → 导出抛错
3. 无标记的普通矩形 → 仍为 Shape
4. 最小 Solid `.pag` 可被 encode 且 header 合法
