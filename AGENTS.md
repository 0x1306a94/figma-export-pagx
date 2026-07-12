# figma-motion-export-pagx

Figma 插件：包含 PAG（`.pag`）与 PAGX（`.pagx`）两套独立导出实现。

## PAG 与 PAGX 边界（严格遵守）

- PAG（`.pag`）与 PAGX（`.pagx`）是两套完全独立的格式、代码路径和验证流程，不得混用。
- 用户讨论 PAG 时，只检查 PAG 导出代码及 libpag 的 PAG 编解码、渲染实现；禁止自动搜索、引用或修改 PAGX 代码，除非用户明确要求比较两者。
- 用户讨论 PAGX 时，只检查 PAGX 导出代码及 PAGX 规范、运行时；禁止自动套用 PAG 二进制编码实现。
- `pagx` CLI 只能处理 `.pagx`，不能验证、解析或渲染 `.pag`；任何 PAG 任务都禁止使用 `pagx verify`。
- 用户只说“导出”但未指明格式时，先根据当前对话和文件扩展名判断；仍有歧义再询问，不默认选择 PAGX。

| 格式 | 项目代码 | libpag 主要参考 | 验证方式 |
|---|---|---|---|
| PAG | `src/export/pag/` | `libpag/exporter/`（AE 导出插件）、`libpag/src/codec/`、`libpag/src/base/`、`libpag/src/rendering/filters/` | `npm test`、PAG 编码测试、`PAGFile::Load()`、PAG SDK 渲染 |
| PAGX | `src/export/` 下的 PAGX 文件 | `libpag/src/pagx/`、`libpag/spec/` | `build_libpag/pagx verify` |

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
    pag/                # Figma → 二进制 PAG；与 PAGX 完全独立
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

## PAGX 导出管线要点

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

## PAGX 验证

以下命令仅适用于 `.pagx`。使用 `pagx` CLI 校验与渲染：

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

## PAG 验证

- 先运行 `npm test`，覆盖项目内 PAG 编码与导出测试。
- 需要验证二进制兼容性时，使用 libpag 的 `PAGFile::Load()` 加载生成的 `.pag`。
- 需要验证视觉结果时，使用 PAG SDK 或 PAGViewer 渲染 `.pag`。
- 不得使用 `build_libpag/pagx` 处理 `.pag`。

## libpag 源码探索

`libpag/` 体量大，**优先用 CodeGraph MCP，不要用 `rg`/grep 扫源码**。查询前必须先按格式选择目录，禁止因仓库名或相似符号跨到另一套格式。

| 场景 | 工具 |
|---|---|
| 查 AE 属性如何映射、PAG 如何从 AE 导出 | `libpag/exporter/`，使用 `codegraph_explore` |
| 查 PAG 二进制 Tag、属性编码、解码流程 | `libpag/src/codec/`、`libpag/src/base/`，使用 `codegraph_explore` |
| 查 PAG 效果与渲染行为 | `libpag/src/rendering/filters/`，使用 `codegraph_explore` |
| 查 PAGX 规范实现、符号定义、调用链、数据流 | `codegraph_explore`（首选）或对应 `codegraph_*` |
| 理解 `SVGImporter`、`pagx verify`、某测试用例在测什么 | `codegraph_context` → `codegraph_explore` |
| 查错误信息、注释、字符串常量等字面量 | grep/read（CodeGraph 不擅长） |
| CodeGraph 未初始化或索引过期 | 先问用户是否 `codegraph init -i`；过期文件再 Read |

PAG 常见入口：`libpag/exporter/`（AE 导出插件）、`libpag/src/codec/`、`libpag/src/base/`、`libpag/src/rendering/filters/`、PAG 相关测试。

PAGX 常见入口：`libpag/spec/`（规范与样例）、`libpag/src/pagx/`（PAGX 运行时）、`libpag/test/src/PAGX*.cpp`（测试）。

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
