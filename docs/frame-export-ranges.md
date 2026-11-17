# 导出：当前帧 PNG 与动画片段

导出对话框（Toolbar → `Export`）顶部的 **Frames to export** 决定这次导出用到时间轴上的哪些帧。

## 四种帧来源

| 选项 | 导出的帧 |
| --- | --- |
| All frames | 整条时间轴 |
| Current frame | 画布上正在显示的那一帧 |
| Frame group | 某个分组里的全部帧（下拉选择分组，按时间轴顺序） |
| Frame range | `From` 到 `To` 的连续片段 |

`From` / `To` 使用时间轴上的帧序号（从 1 开始、含两端）。输入越界会自动夹到时间轴范围内，`From` 大于 `To` 时按先小后大处理，所以反着填也能导出同一段。

以下几种导出都会跟随这个选择：

- PNG sprite sheet
- Individual frames（逐帧 PNG，写入选中的文件夹）
- Animated GIF
- Animated PNG
- JSON animation data

只有 **Save complete project JSON** 例外：它始终保存整个工程（所有帧），因为它不是"导出动画"而是备份。

## 只导出当前帧

`Current frame PNG` 按钮无视上面的帧来源选择，直接把画布上当前显示的那一帧导出成一张 PNG：

- 尺寸就是项目画布尺寸（不会裁边、不会做 sprite sheet 排版），保留透明通道；
- 文件名是 `<工程名>-frame-004.png`，序号就是该帧在时间轴上的真实位置；
- 想连续导出多帧、又要保持真实序号，用 `Individual frames`，命名同样是 `<工程名>-004.png`。

## 预览与文件名

- 对话框里的 PNG 预览、最小安全帧尺寸都按当前选择计算；选 `Current frame` 时预览就是那一帧本身。
- 动画文件名会带上片段信息，方便区分：
  - 全部帧：`untitled-character.gif`
  - 当前帧：`untitled-character-frame-004.png`
  - 片段：`untitled-character-002-008.gif`（第 2 到第 8 帧）、`untitled-character-002-008.animation.json`
  - 逐帧：`untitled-character-004.png`（始终用时间轴真实帧号）
- 工程名会转成小写连字符形式，例如 `My Hero` → `my-hero`。

## 测试

```powershell
node scripts/test-export-frame-selection.mjs
```
