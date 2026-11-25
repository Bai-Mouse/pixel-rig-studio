# Codex 动画助手

打开项目后，点击顶部工具栏的 **Codex Chat**。

## 连接

桌面版会自动查找本机 Codex CLI。点击“连接设置 → 保存并检测”即可检查可执行程序及登录状态。
可以手动选择 `codex.exe` 的完整路径，模型名称留空时使用 Codex CLI 默认模型。

未登录时，面板会显示 PowerShell 登录命令。完成登录后重新检测。
无需在 Pixel Rig Studio 中粘贴 API Key 或登录令牌。

### Claude Code CLI

和 Codex 一样走本机已登录的 CLI，不需要 API Key（Claude Pro/Max 订阅即可）。
1. 安装 Claude Code（PowerShell：`irm https://claude.ai/install.ps1 | iex`），在终端运行 `claude` 并按提示登录（或输入 `/login`）。
2. 在“连接设置”里选择 **Claude Code CLI**，点击“保存并检测”。路径留空会自动查找 PATH、`%USERPROFILE%\.local\bin\claude.exe` 和 npm 安装的 `claude.cmd`。
3. 模型可留空，或填 `sonnet` / `opus` / `haiku`。

请求在空的临时目录中以 `claude -p` 非交互模式运行，禁用全部内置工具和 MCP，只返回编辑方案。
调用时不读取 `~/.claude/settings.json` 等用户配置，所以即使用 CC Switch 把终端里的 Claude Code 切到了第三方服务商，这里仍使用 claude.ai 账号。

Codex 会收到当前节点属性、帧数据、素材名称/尺寸和最近对话；不发送素材 PNG 或画布像素。
聊天记录仅在当前编辑器会话中保留，关闭面板不会清空记录。

## 编辑

例如：

- “把选中帧里左臂的旋转改为 20 度。”
- “在当前帧后复制 6 帧，并给双臂添加摆动，创建 Walk 组。”
- “把 Head 节点在所有帧的 Sorting Order 改为 10。”
- “添加一个空的 Effect 子节点。”

Codex 返回修改清单，展开后可以查看具体节点、帧编号和属性值。
点击“应用修改”一次应用整个清单；点击“放弃方案”不改变项目。
如果生成方案后编辑了项目，请重新发送请求，以避免使用过期方案。

可编辑节点名称、Pivot、可见性、锁定状态、贴图列表和每帧的位置、旋转、缩放、可见性、贴图选择、排序。
支持添加/删除节点、复制/删除/移动帧、帧分组、FPS 和循环设置。
暂不支持通过聊天直接绘制像素、导入外部素材、切换父级或改写软件源代码。

## 撤销

每次应用 Codex 方案是一笔独立的编辑历史。“撤销最近修改”或 `Ctrl+Z` 撤销整笔修改；
“重做”、`Ctrl+Y` 或 `Ctrl+Shift+Z` 恢复它。聊天消息会标记“已应用”或“已撤销”。
后续手动编辑也会在撤销 AI 修改前保留为可重做的检查点，避免被覆盖。
编辑历史存在当前会话中，重新加载项目后不会保留。

生成过程中可以取消请求，取消后返回的回复不会应用到项目。
AI 只输出结构化编辑方案；软件校验全部操作成功后才提交，任一操作失败都不会留下部分修改。

## 验证

`node scripts/test-codex-edit.mjs` 运行离线编辑、撤销和冲突回归检查。
`node scripts/test-codex-live.mjs <codex.exe完整路径>` 使用固定的空素材、人造测试节点进行真实连接测试，消耗一次 Codex 请求。

参考：[官方 Codex 非交互模式文档](https://developers.openai.com/codex/noninteractive)。
