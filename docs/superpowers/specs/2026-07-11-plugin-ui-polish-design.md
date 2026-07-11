# 插件 UI 面板美化 — 设计

**状态：** 已实现  
**范围：** [`ui.html`](../../../ui.html)、[`src/code.ts`](../../../src/code.ts)。不改导出管线。

## 背景

当前面板纵向堆叠：刷新、导出 PAGX、导出 PAG、关闭；动画 JSON 常驻展开占高；PAG 文件大小以 raw bytes 显示；关闭按钮与宿主自带关闭重复。

另：`setExportBusy` 已会同时改两个导出按钮文案，但 `onmessage` 对任意消息都调用 `setExportBusy(false)`，选区变化等会误清导出中状态。

## 目标

1. 任一导出进行中，两个导出按钮均显示「导出中...」且 disabled；仅在导出成功/失败时恢复。
2. 动画 JSON 默认隐藏，用开关打开（开发者调试用）。
3. 导出结果文件大小格式化为 B / KB / MB。
4. 去掉面板内「关闭」按钮，并删除对应 `cancel` 消息处理。
5. 布局采用分区纵向：准备 / 导出 / 开发者；面板高度随 JSON 默认折叠下调。

## 设计决策

### D1. 布局：分区纵向

```
标题 + 说明
── 准备 ──
锚点警告 + 刷新锚点缓存 + 刷新状态
── 导出 ──
导出 PAGX
导出 PAG
meta / error / diagnostics
── 开发者 ──
[开关] 显示动画数据（默认关）
（开启后）hint + motion JSON
```

视觉微调：分区小标题、间距与圆角与现有 Figma 插件风格一致；不引入新字体/主题依赖。

### D2. 导出联动态

```
setExportBusy(busy):
  exportPagx / exportPag 同时 disabled
  文案：busy →「导出中...」；否则恢复「导出 PAGX」/「导出 PAG」

onmessage:
  selection-motion-data / refresh-motion-anchor-result → 不改导出按钮状态
  export-result | export-pag-result | export-error → setExportBusy(false)
  refresh 相关消息单独恢复刷新按钮
```

### D3. 动画数据开关

- 默认 off；不持久化（YAGNI）。
- off：隐藏 `#motion-hint` 与 `#motion-json`。
- on：与现行为一致，展示选区 JSON。
- 无论开关，仍接收并缓存 `selection-motion-data`（打开开关即可看到最新数据）。

### D4. 文件大小格式化

```
formatBytes(n):
  n < 1024           → `${n} B`
  n < 1024 * 1024    → `${(n / 1024).toFixed(1)} KB`
  else               → `${(n / (1024 * 1024)).toFixed(2)} MB`
```

- `.pag`：`formatBytes(msg.bytes.length)`
- `.pagx`：`formatBytes(new Blob([msg.xml]).size)`（或等价 `TextEncoder` 字节长度）

meta 文案示例：

- PAGX：`画布 W × H，节点 N 个，.pagx X.X KB`
- PAG：`画布 W × H，节点 N 个，.pag X.X KB`

### D5. 去掉关闭

- 删除 `#cancel` 按钮及点击逻辑。
- `src/code.ts`：从 `PluginMessage` 去掉 `{ type: 'cancel' }`，删除 `figma.closePlugin()` 分支。
- `figma.showUI` 高度：`560` → `420`（JSON 默认折叠后足够）。

## 非目标

- 不改导出算法、诊断逻辑、锚点刷新语义。
- 不做深色主题、不引入构建步骤拆分 UI。
- 动画开关不做 localStorage 持久化。

## 验收

1. 点「导出 PAG」或「导出 PAGX」，两按钮同时变为「导出中...」且不可点；导出结束恢复。
2. 导出过程中切换选区（若触发 motion 消息），导出按钮仍保持 busy。
3. 默认不显示动画 JSON；打开开关后可见。
4. 导出成功后 meta 中文件大小为 B/KB/MB。
5. 面板无「关闭」按钮；宿主关闭仍可用。
