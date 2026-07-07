# figma-export-pagx

Figma 插件：将选中节点静态导出为 PAGX（`.pagx`）。第一版不含动画。

## 开发

```bash
npm install
npm run build    # 编译插件 → code.js
npm test
npm run watch    # 开发时监听
```

Figma 中重新加载插件后，选中 1 个 root 节点导出。

## 目录

```
src/
  code.ts              # 插件入口
  export/
    index.ts           # exportPagx() 入口
    figma-to-pagx.ts   # Figma 节点 → PagxLayer 主映射
    figma-reader.ts    # 读取 fills/strokes/effects/坐标/transform
    pagx-writer.ts     # IR → XML
    path-detect.ts     # VECTOR 路径识别 → Rectangle/Ellipse
    types.ts           # PagxDocument / PagxLayer / PagxElement
test/
  fixtures/            # 样例 .pagx
libpag/                # 可选，本地 clone 的 libpag（gitignore）
build_libpag/          # pagx CLI 编译输出（gitignore）
```

## 导出管线要点

| 模块 | 作用 |
|------|------|
| `figma-to-pagx.ts` | 1 Figma 节点 → 1 `PagxLayer`；TEXT 单独走 `mapTextNode` |
| `figma-reader.ts` | `nodePositionInParent` 用 AABB 差值；`nodeMatrixInParent` 含平移补偿 |
| `path-detect.ts` | 轴对齐矩形、圆角矩形、椭圆识别，减少 Path warning |
| `pagx-writer.ts` | 空 `Path data` 不输出；`left/top=0` 省略 |

### 坐标与变换

- **布局位置**（`left/top`）：`absoluteBoundingBox` 相对父节点差值
- **旋转/翻转**（`matrix`）：由 `absoluteTransform` 分解，`tx/ty` 减去 AABB 偏移以补偿变换原点
- **LINE**：本地路径 `M 0 0 L width height` + Layer `matrix`；无几何时 fallback `strokeGeometry`

### 文本

- 仍用 **Layer 包裹 Text + Fill**（与 `libpag/spec/samples/text.pagx` 一致）
- **纯文本**：`left/top` 写在 `<Text>` 上，wrapper Layer 不设 `width/height`
- **有 matrix / alpha / blendMode**：变换属性保留在 wrapper Layer

### 规范参考

- PAGX 规范：`libpag/spec/pagx_spec.zh_CN.md`
- 示例：`libpag/spec/samples/`

## 验证导出

使用 `pagx` CLI 校验与渲染：

```bash
build_libpag/pagx verify path/to/export.pagx   # 校验 + 生成 .layout.xml
build_libpag/pagx verify path/to/export.pagx --render  # 额外输出 .png
```

### pagx CLI 不存在时

若 `build_libpag/pagx` 不存在，按以下流程编译：

```bash
git clone git@github.com:Tencent/libpag.git
cd libpag
./sync_deps.sh
cd ..
mkdir build_libpag

cmake -DPAG_BUILD_CLI=ON -DPAG_BUILD_SHARED=OFF -DCMAKE_BUILD_TYPE=Release -B build_libpag -S libpag
cmake --build build_libpag --target pagx-cli -j$(sysctl -n hw.ncpu)

# 使用时
build_libpag/pagx
```
