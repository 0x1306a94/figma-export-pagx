# Figma Motion 直接导出 PAG 设计文档

面向作者的图层制作规则（纯色 / 图片 / 文本）见：**[pag-authoring-rules.md](./pag-authoring-rules.md)**。

## 1. AE 插件导出 PAG 流程

对照 `libpag/exporter`：

```text
PAGExport::exportFile()
  → exportAsFile()
      → ExportComposition()          // Vector / Bitmap / Video
          → ExportVectorComposition()
              → ExportLayers() → ExportLayer() + InitLayer()
                  → GetTransform2D() / GetMasks() / GetShapes() …
      → Codec::InstallReferences()
      → addRootComposition()         // 可选 work area 裁剪
      → exportResources()            // 图片 / 序列帧
      → Codec::VerifyAndMake()
  → Codec::Encode(pagFile)
  → 写 .pag 文件
```

关键点：

| 模块 | 作用 |
|------|------|
| `ExportComposition` | 按类型建 `Composition` |
| `InitLayer` | 时间、`Transform2D`、mask、effect |
| `GetTransform2D` | AE stream → Property 关键帧 |
| `GetMasks` | AE mask → `MaskData` |
| `Codec::Encode` | Tag 二进制（header `PAG` + version + body） |

## 2. PAG 文件结构要点

定义见 `libpag/include/pag/file.h`。

- **File**：`compositions[]`（最后一个为主 composition）、`images[]`
- **VectorComposition**：`width/height/duration/frameRate` + `layers[]`
- **Layer**：`transform`（`Transform2D`）、`masks[]`、按类型 contents
- **Transform2D**：`anchorPoint` / `position` / `scale` / `rotation` / `opacity`（Property）
- **MaskData**：`maskPath` + `maskMode` + opacity/expansion
- **编码**：`EncodeStream`（小端）+ TagHeader（code<<6 | length）+ Attribute Block（bit flag + value）

文件头：

```text
'P' 'A' 'G' | version(u8=1) | bodyLength(u32) | compression(u8=0) | body tags… | End
```

## 3. 当前 Figma → PAGX 能力与差距

已有：`exportPagx` → 静态布局 + Motion（PAGX Animation/Channel）+ mask（Layer maskType）。

差距：无 `pag::File` IR、无 Tag 二进制编码；PAGX 动画模型（Group matrix 通道）与 PAG `Transform2D` 不同构，不宜做 PAGX→PAG 硬转。

## 4. 选定方案

**共享读取层，双写出口**（保留 `.pagx` + 新增 `.pag`）：

```text
figma-reader / path-detect / figma-motion 采样
        ├─→ figma-to-pagx → pagx-writer → .pagx
        └─→ figma-to-pag  → pag-codec（TS）→ .pag
```

### 第一版范围

- 做：VectorComposition；Shape / Text / Image / PreCompose；Transform2D + opacity；Mask
- 不做：Video/Bitmap sequence、effect、camera、audio、3D

### 关键约定

| 项 | 约定 |
|----|------|
| frameRate | 30（`MOTION_FRAME_RATE` 默认；面板可选 24 / 30 / 60） |
| 锚点 | 普通层：节点中心；ImageLayer：原图中心 `(imgW/2, imgH/2)` |
| position | 父坐标下锚点位置 = left/top + 节点半宽高（Image 亦用节点框中心） |
| opacity | Figma 0–1 → PAG 0–255 |
| scale | 1.0 = 100%（对齐 AE ScaleParser / Transform2D 默认 `(1,1)`）；Image 另乘 scaleMode 映射 |
| 嵌套 | Frame/Group → PreComposeLayer + 子 VectorComposition |
| Mask | `isMask` 几何 → 被遮罩层 `masks[]`；alpha/luminance 无法忠实时 warning |
| 图片 | `imageHash` → 原图 PNG/JPEG 直通 `ImageBytesV3`；同 hash 去重；FILL/FIT/CROP→Transform scale（对齐 AE footage，不强制 WebP） |
| 文本 | 按 [PAG 点/框规则](https://pag.io/docs/editable-text.html)：`WIDTH_AND_HEIGHT`→点文本（基线锚点）；`NONE`/`HEIGHT`/`TRUNCATE`→框文本（`boxTextPos=(0,0)`，`boxTextSize=AABB`，`firstBaseLine≈0.8×fontSize`）；映射水平对齐/行距/字距；框文本可能缩字号或垂直居中 |

### 模块

```text
src/export/pag/
  types.ts
  figma-to-pag.ts
  image-bytes.ts   # 尺寸解析 / hash 去重 / scaleMode
  encode/
    encode-stream.ts
    tag-code.ts
    attribute-helper.ts
    data-types.ts
    encode-file.ts
    encode-layer.ts
    encode-shapes.ts
  index.ts   # exportPag()
```

### 验证

- 单元测试：EncodeStream、最小 Shape/Image PAG、PNG 头解析、scaleMode、同 hash 去重
- 手工：同节点 `.pagx` + `.pag`，PAGViewer 打开对照（含 Frame10 图片层）
- 硬门槛：字节可被 `pag::File::Load` 打开

## 5. 风险

- TS Codec 必须与 C++ Tag/Attribute 布局一致
- Figma Mask 与 PAG 路径 Mask 不完全同构
- 文本依赖 FontTables + TextDocument；字体缺失时运行时回退系统字体

## 6. 验证说明

### 单元测试

```bash
npm test   # 含 EncodeStream、最小 Shape PAG、mask、position/opacity 关键帧
```

### 手工对照

1. Figma 中选中同一 root，分别点「导出 PAGX」与「导出 PAG」
2. 用 PAGViewer 打开 `.pag`，对照 Figma 画布与 `.pagx` 布局
3. 硬门槛：字节头为 `PAG\\x01`，可被 `pag::File::Load` / PAGViewer 打开

### 可选 CLI

若本地有 `build_libpag`，可对导出的 `.pag` 做加载验证（PAGViewer 或自写 Load 小工具）。
