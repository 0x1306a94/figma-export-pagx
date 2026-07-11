# Figma → PAG 图层制作规则

面向在 Figma 中制作、并用本插件导出 `.pag` 的作者。对齐 AE/PAG 语义，并说明本插件的映射约定。

官方参考：

- [Text Editing Rules](https://pag.io/docs/editable-text.html)
- 实现细节见 `docs/pag-export-design.md` 与 `docs/superpowers/specs/`

适用范围：**导出 PAG（`.pag`）**。PAGX 行为可能不同（例如 `#solid` 仅去前缀，不产生 SolidLayer）。

---

## 1. 纯色图层（Solid）

用于运行时需要 `setSolidColor` 动态改色的色块，对应 PAG `SolidLayer`（对齐 AE Solid）。

### 1.1 何时用 Solid

| 需求 | 做法 |
|------|------|
| 业务侧要改色 | 图层名加 `#solid`，按下方合格条件制作 |
| 仅静态色块、不改色 | 普通矩形即可（导出为 ShapeLayer） |
| 圆角 / 描边 / 渐变色块 | **不要**用 `#solid`，用普通 Shape |

### 1.2 命名

- 前缀：`#solid`（大小写不敏感）
- 导出名：去掉前缀及紧随空格  
  - `#solid Brand` → 层名 `Brand`  
  - `#Solid背景` → 层名 `背景`

运行时按**导出名**查找：

```ts
const layers = pagFile.getLayersByName('Brand');
(layers[0] as PAGSolidLayer).setSolidColor({ red, green, blue });
```

### 1.3 合格条件（必须全部满足）

1. 图层名带 `#solid`
2. `RECTANGLE`，或可识别为轴对齐**直角**矩形的 VECTOR
3. 恰好 **1** 个可见纯色 Fill（禁止渐变 / 图片）
4. 无可见描边
5. 无圆角（corner radius = 0）
6. 无 WIDTH / HEIGHT 尺寸动画（Solid 宽高为静态字段）

特效：有则忽略，不因此失败。

### 1.4 不合格时

有 `#solid` 但不满足条件 → **整次导出失败**（不降级为 Shape）。请改名去掉 `#solid`，或改成合格矩形后再导出。

### 1.5 透明度

Fill opacity × 图层 opacity → 层 `Transform2D.opacity`；`solidColor` 只写 RGB。

---

## 2. 图片图层（Image）

对齐 AE footage：嵌入原图像素，用 Transform 的 scale 适配节点框（非把图画成节点尺寸的烘焙位图）。

### 2.1 制作建议

| 项 | 建议 |
|----|------|
| Fill | 使用 **IMAGE** fill；同一张图可多处引用（同 `imageHash` 会去重） |
| 编码 | PNG / JPEG 原图直通；不必转 WebP |
| 节点类型 | 矩形等带 IMAGE fill 的几何节点即可 |
| 多图 fill | 仅导出**第一个**可见 IMAGE fill，其余 warning |

### 2.2 Scale Mode 映射

| Figma `scaleMode` | PAG 行为（近似） |
|-------------------|------------------|
| `FILL` | cover：铺满节点框，可能裁切 |
| `FIT` | contain：完整可见，可能留边 |
| `CROP` | 从 `imageTransform` 推 scale；失败时回退 FILL |
| `TILE` | 暂不忠实平铺，按拉伸处理并 warning |

### 2.3 坐标系（理解用）

- 锚点：原图中心 `(imgW/2, imgH/2)`
- position：节点框中心（父坐标）
- scale：由 scaleMode + 原图尺寸 / 节点尺寸算出

超出父 Frame 的部分依赖 composition / mask 裁剪（与 AE 预合成裁剪类似）。

### 2.4 注意

- 不要依赖「导出时烘焙成节点像素图」；运行时改图 / 替换走 ImageBytes，与 AE 资源模型一致
- 复杂蒙版、多 fill 叠加可能不完全一致，以 warning 与 PAGViewer 对照为准

---

## 3. 文本图层（Text）

对应 PAG `TextLayer` + `TextDocument`。制作前请先读官方 [点文本与框文本](https://pag.io/docs/editable-text.html)。

### 3.1 可编辑 vs 不可编辑（官方惯例）

| 类型 | 建议 |
|------|------|
| **可编辑文本**（运行时要换文案） | 用文本图层导出 |
| **不可编辑文本**（特殊字体效果、只需像素一致） | 建议大纲化为形状，或栅格化后当图片 |

本插件导出文本层时：字体名写入 FontTables；缺字时运行时回退系统字体，**视觉可能与 Figma 不一致**。关键品牌字体请确保端上可加载。

### 3.2 点文本 vs 框文本（核心）

AE/PAG 两种文本：

| | 点文本 | 框文本 |
|--|--------|--------|
| 自动换行 | 否 | 是 |
| PAG 与制作稿 | **一致** | 可能不一致 |

框文本 PAG **额外规则**（官方）：

1. **框高度不够** → 自动**缩小字号**，塞进框内  
2. **框高度大于行数** → **强制垂直居中**

因此：

- 不需要自动换行 → 用点文本  
- 需要换行且接受垂直居中 → 用框文本  
- 需要换行但要顶对齐 → 框高收到「刚好放下」的临界高度；或点文本 + 手动换行 `\n`

### 3.3 Figma 设置 → 本插件映射

| Figma `Text auto resize` | 导出为 | 说明 |
|--------------------------|--------|------|
| **Auto width**（`WIDTH_AND_HEIGHT`） | **点文本** | 不软换行；层锚在基线，排版最稳 |
| **Auto height**（`HEIGHT`） | **框文本** | 定宽软换行；框高≈内容，接近临界高度，减轻垂直居中 |
| **Fixed size**（`NONE`） | **框文本** | 固定框软换行；框比文字高时 PAG 会垂直居中 |
| **Truncate** | **框文本** + warning | 高度外裁切依赖运行时 |

水平对齐（左/中/右/两端）、行高、字距会写入 `TextDocument`。

垂直对齐：

- `TOP` + Fixed size：可能被 PAG 强制居中（会 warning）  
- `CENTER`：与 PAG 框文本居中一致  
- `BOTTOM`：PAG 无底对齐（warning）

### 3.4 推荐制作清单

1. **标题 / 按钮短文、不换行** → Auto width（点文本）  
2. **段落、定宽换行、字数大致固定** → Auto height，或 Fixed size 且框高贴内容  
3. **定宽换行、字数会变多、且必须顶对齐** → 目前 PAG 无开关；优先点文本 + `\n`，或接受框文本居中 / 缩字号  
4. **不要**对「只需顶对齐的长文」随手用很高的 Fixed size 框（会触发垂直居中）  
5. 混合字体 / 逐字样式：插件取默认值并 warning，复杂样式请拆层或转形状  

### 3.5 与官方文档的关系

本插件不改变 PAG 运行时规则，只按 Figma 属性选择点/框并填写字段。框文本的缩字号、垂直居中以 [pag.io 文本规则](https://pag.io/docs/editable-text.html) 为准。

---

## 4. 快速对照

| 目标 | Figma 做法 |
|------|------------|
| 运行时改色块颜色 | `#solid` + 直角纯色矩形、无描边无圆角 |
| 运行时换图 / 省体积复用 | IMAGE fill，同一资源多处引用 |
| 运行时换短文案、位置稳 | 文本 Auto width（点文本） |
| 定宽段落、可接受居中 | 文本 Auto height 或贴合内容的 Fixed size |
| 特殊字形绝对一致 | 转形状或栅格，不要依赖文本层 |

---

## 5. 验证

1. 插件导出 `.pag`  
2. PAGViewer 打开，对照 Figma  
3. 有 `#solid` 失败时看报错改图层；文本/图片 warning 看导出面板  

实现与编码细节见 `docs/pag-export-design.md`。
