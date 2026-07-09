# figma-motion-export-pagx

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

cmake -DPAG_BUILD_CLI=ON -DPAG_BUILD_SHARED=OFF -DPAG_BUILD_FRAMEWORK=OFF -DCMAKE_BUILD_TYPE=Release -B build_libpag -S libpag
cmake --build build_libpag --target pagx-cli -j$(sysctl -n hw.ncpu)

# 使用时
build_libpag/pagx
```

## libpag 源码探索

`libpag/` 体量大（C++、PAGX 导入/导出、CLI、测试），**优先用 CodeGraph MCP，不要用 `rg`/grep 扫源码**。

| 场景 | 工具 |
|---|---|
| 查 PAGX 规范实现、符号定义、调用链、数据流 | `codegraph_explore`（首选）或对应 `codegraph_*` |
| 理解 `SVGImporter`、`pagx verify`、某测试用例在测什么 | `codegraph_context` → `codegraph_explore` |
| 查错误信息、注释、字符串常量等字面量 | grep/read（CodeGraph 不擅长） |
| CodeGraph 未初始化或索引过期 | 先问用户是否 `codegraph init -i`；过期文件再 Read |

常见入口：`libpag/spec/`（规范与样例）、`libpag/src/pagx/`（PAGX 运行时）、`libpag/test/src/PAGX*.cpp`（测试）。

<!-- CODEGRAPH_START -->
## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol named X" | `codegraph_search` |
| "What calls function Y?" | `codegraph_callers` |
| "What does Y call?" | `codegraph_callees` |
| "How does X reach/become Y? / trace the flow from X to Y" | `codegraph_trace` (one call = the whole path, incl. callback/React/JSX dynamic hops) |
| "What would break if I changed Z?" | `codegraph_impact` |
| "Show me Y's signature / source / docstring" | `codegraph_node` |
| "Give me focused context for a task/area" | `codegraph_context` |
| "See several related symbols' source at once" | `codegraph_explore` |
| "What files exist under path/" | `codegraph_files` |
| "Is the index healthy?" | `codegraph_status` |

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" / architecture questions, answer with 2-3 codegraph calls: `codegraph_context` first, then ONE `codegraph_explore` for the source of the symbols it surfaces. For a specific **flow** ("how does X reach Y") start with `codegraph_trace` from→to — one call returns the whole path with dynamic hops bridged — then ONE `codegraph_explore` for the bodies; don't rebuild the path with `codegraph_search` + `codegraph_callers`. Codegraph IS the pre-built index, so spawning a separate file-reading sub-task/agent — or running a grep + read loop — repeats work codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_context` is one call.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore` call returns several symbols' source grouped in a single capped call, while each separate node/Read call re-reads the whole context and costs far more.
- **Index lag — check the staleness banner, don't guess a wait.** When a codegraph response starts with "⚠️ Some files referenced below were edited since the last index sync…", the listed files are pending re-index — Read those specific files for accurate content. Files NOT in that banner are fresh and codegraph is authoritative for them. `codegraph_status` also lists pending files under "Pending sync".

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: *"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"*
<!-- CODEGRAPH_END -->