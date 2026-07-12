# PAG 内置效果映射设计

## 目标

在直接 `.pag` 导出链路中，将 Figma 的以下内置效果映射为二进制 PAG 原生能力：

- `LAYER_BLUR` → `FastBlurEffect`
- `DROP_SHADOW` → `DropShadowStyleV2`

PAGX 与本功能完全独立。本设计不经过、不修改，也不复用 PAGX 的 IR、映射器或 XML writer。

## 范围

首版支持所有带 `effects` 的 PAG 图层类型，包括 Image、Shape、Text、Solid、PreCompose。隐藏效果不导出。

以下效果不在首版范围：

- `INNER_SHADOW`
- `BACKGROUND_BLUR`
- `GLASS`、`NOISE`、`TEXTURE`、`SHADER`
- Figma ImagePaint 的 exposure、contrast、saturation 等图片滤镜
- 效果动画
- 不受 PAG 原生模型支持的跨 Effect/LayerStyle 全局顺序还原

不支持的可见效果保留现有导出结果，并产生 warning，不中止整个 PAG 导出。

## 数据流

```text
Figma SceneNode.effects
  → mapNodeEffects()
  → PagLayer.effects / PagLayer.layerStyles
  → writeEffects() / writeLayerStyles()
  → PAG Tag 60 / Tag 65
  → libpag decoder
  → FilterRenderer / LayerStylesFilter
```

实现只依赖以下二进制 PAG 模型：

- `libpag/include/pag/file.h`
- `libpag/src/codec/tags/EffectTag.cpp`
- `libpag/src/codec/tags/LayerStyleTag.cpp`
- `libpag/src/rendering/filters/`

## PAG IR

在 `PagLayerBase` 增加两个公共数组，使所有图层类型复用相同映射与编码逻辑：

```ts
enum PagBlurDimensions {
  All = 0,
  Horizontal = 1,
  Vertical = 2,
}

type PagFastBlurEffect = {
  kind: 'fastBlur';
  blurriness: PagProperty<number>;
  blurDimensions: PagProperty<PagBlurDimensions>;
  repeatEdgePixels: PagProperty<boolean>;
  effectOpacity: PagProperty<PagOpacity>;
};

type PagDropShadowStyle = {
  kind: 'dropShadow';
  blendMode: PagProperty<BlendMode>;
  color: PagProperty<PagColor>;
  opacity: PagProperty<PagOpacity>;
  angle: PagProperty<number>;
  distance: PagProperty<number>;
  size: PagProperty<number>;
  spread: PagProperty<number>;
};

type PagLayerBase = {
  // existing fields
  effects: PagFastBlurEffect[];
  layerStyles: PagDropShadowStyle[];
};
```

首版联合类型只有一个成员，不为尚未实现的 PAG 效果预先增加类型。

## LAYER_BLUR 映射

普通 Layer Blur 映射为：

```ts
{
  kind: 'fastBlur',
  blurriness: staticProperty(effect.radius),
  blurDimensions: staticProperty(PagBlurDimensions.All),
  repeatEdgePixels: staticProperty(false),
  effectOpacity: staticProperty(OPAQUE),
}
```

`blurriness` 直接使用 Figma `radius`。libpag 的 `FastBlurEffect` 渲染时使用 `blurriness / 2` 作为高斯 sigma，与 Figma 导出 SVG 时 blur radius 的含义一致。

Figma Progressive Blur 没有 PAG 对应参数。首版使用 `effect.radius` 降级为均匀模糊，并输出：

```text
PAG_PROGRESSIVE_BLUR_FALLBACK
```

## DROP_SHADOW 映射

### 偏移

PAG 使用 angle 和 distance，Figma 使用二维 offset：

```ts
const distance = Math.hypot(effect.offset.x, effect.offset.y);
const angle = normalizeDegrees(
  radiansToDegrees(Math.atan2(-effect.offset.y, effect.offset.x)) + 180,
);
```

该公式与 libpag 的还原公式互逆：

```ts
offsetX = Math.cos(degreesToRadians(angle - 180)) * distance;
offsetY = -Math.sin(degreesToRadians(angle - 180)) * distance;
```

零距离时 angle 固定为 `0`，避免无意义的浮点变化。

### 模糊与扩散

Figma `spread` 是像素值，PAG `spread` 是 `size` 的比例。映射公式为：

```ts
const figmaSpread = Math.max(0, effect.spread ?? 0);
const size = Math.max(0, effect.radius) + figmaSpread;
const spread = size > 0 ? figmaSpread / size : 0;
```

由此满足：

```text
PAG spread pixels = size × spread = Figma spread
PAG blur diameter = size × (1 - spread) = Figma radius
```

### 颜色、透明度与混合模式

Figma RGBA 拆为 PAG RGB 与 Opacity：

```ts
color = rgbToPagColor(effect.color);
opacity = opacityToPag(effect.color.a);
```

首版仅支持 PAG IR 已有的 `BlendMode.Normal`。如果 Figma 阴影使用其他 blend mode，则降级为 Normal，并输出：

```text
PAG_DROP_SHADOW_BLEND_MODE_FALLBACK
```

`showShadowBehindNode` 没有完全等价的 PAG 字段。首版遵循 PAG DropShadowStyle 的原生合成行为；仅在该值要求不同合成语义时输出 warning，不增加烘焙分支。

## 二进制编码

新增两个职责单一的编码文件：

```text
src/export/pag/encode/encode-effects.ts
src/export/pag/encode/encode-layer-styles.ts
```

### FastBlurEffect

写入 `TagCode.FastBlurEffect = 60`，字段顺序严格对齐 `FastBlurEffectTag()`：

1. `blurriness`：SimpleProperty float，默认 `0`
2. `blurDimensions`：DiscreteProperty uint8，默认 `All`
3. `repeatEdgePixels`：DiscreteProperty bool，默认 `false`
4. `effectOpacity`：SimpleProperty opacity，默认 `255`
5. mask references：CustomAttribute，首版写空

### DropShadowStyle

统一写入 `TagCode.DropShadowStyleV2 = 65`，避免旧 Tag 29 对 `size` 的离散属性限制，并支持 `spread`：

1. `blendMode`：DiscreteProperty uint8，默认 Normal
2. `color`：SimpleProperty Color，默认 Black
3. `opacity`：SimpleProperty Opacity，默认 191
4. `angle`：SimpleProperty float，默认 120
5. `distance`：SimpleProperty float，默认 5
6. `size`：SimpleProperty float，默认 5
7. `spread`：SimpleProperty Percent，默认 0

`writeLayer()` 按 libpag 的 Layer Tag 顺序写入 layer attributes、masks、transform、effects、layer styles 和图层内容。最终顺序以 `libpag/src/codec/tags/LayerTag.cpp` 为准。

## 映射接口

Figma 映射集中在 `figma-to-pag.ts`，编码层不依赖 Figma API 类型：

```ts
function mapNodeEffects(
  node: SceneNode,
  diagnostics: Diagnostic[],
): {
  effects: PagFastBlurEffect[];
  layerStyles: PagDropShadowStyle[];
} {
  const effects = [];
  const layerStyles = [];

  for (const effect of node.effects) {
    if (effect.visible === false) continue;

    if (effect.type === 'LAYER_BLUR') {
      effects.push(mapLayerBlur(effect, diagnostics, node.id));
    } else if (effect.type === 'DROP_SHADOW') {
      layerStyles.push(mapDropShadow(effect, diagnostics, node.id));
    } else {
      addUnsupportedEffectDiagnostic(effect, node.id, diagnostics);
    }
  }

  return { effects, layerStyles };
}
```

`layerBase()` 调用 `mapNodeEffects()`，确保所有 PAG 图层类型行为一致。

## 顺序限制

PAG 将 `LayerStyle` 和 `Effect` 分为两个阶段处理，无法严格表达 Figma effects 数组中 Drop Shadow 与 Layer Blur 的任意交错顺序。首版遵循 PAG 原生顺序：LayerStyle 先参与图层合成，随后应用 Effect。

同类效果维持 Figma 数组内的相对顺序。若同一节点同时存在 Drop Shadow 和 Layer Blur，导出成功，但增加诊断说明可能存在渲染顺序差异，不引入图片烘焙。

## 错误处理

- 隐藏效果：跳过，不输出诊断。
- 不支持的可见效果：warning，继续导出。
- Progressive Blur：均匀模糊降级 warning。
- 非 Normal Drop Shadow blend mode：Normal 降级 warning。
- 非有限数值：使用安全默认值并输出 warning，禁止把 `NaN` 或 Infinity 写入 PAG。
- 编码结构错误：测试阶段由 libpag 解码/verify 捕获；运行时不静默吞掉编码异常。

## 测试

### 单元测试

- 普通 `LAYER_BLUR radius=20` 映射为静态 blurriness 20。
- Progressive Blur 映射为均匀模糊并产生指定 warning。
- 隐藏 blur 不写入。
- Drop Shadow 上、下、左、右及斜向 offset 的 angle/distance 可逆。
- 零 offset 得到 distance 0 和稳定 angle。
- RGBA 正确拆分为 PagColor 与 PagOpacity。
- spread 为 0、正数以及 radius 为 0 时换算正确。
- 多个 Drop Shadow 保持相对顺序。
- 非 Normal blend mode 产生 warning 并降级。

### 编码测试

- Fast Blur 生成 Tag 60。
- Drop Shadow 生成 Tag 65。
- 两种效果的属性位图、属性值和 TagBlock 长度正确。
- 无效果图层不产生 Effect/LayerStyle Tag。
- 同一图层多个效果均能被 libpag 解码。

### 集成验证

- `npm test` 全量通过。
- 使用项目内 `build_libpag/pagx` 或对应 libpag 校验入口加载生成的 `.pag`。
- 渲染包含 blur、shadow 和二者组合的固定样例，检查尺寸扩展、偏移和透明度。
- 使用 Frame10 做人工回归，但忽略其中的 Figma Shader。

## 完成标准

- 直接 PAG 导出能够保存并渲染普通 Layer Blur 与 Drop Shadow。
- 生成文件可被当前项目的 libpag 成功解码。
- 不影响无效果节点及既有 PAG/PAGX 测试。
- 所有降级行为均有明确、稳定的 diagnostic code。
