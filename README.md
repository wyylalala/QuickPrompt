# QuickPrompt

**炼化 Prompt，一键执行** — a DeepSeek Harness (DSH) plugin that turns a rough request into a structured prompt, saves it as a slash command, and runs it again in one keystroke.

把一句口语需求「炼化」成结构化 Prompt，保存成自己的斜杠命令，之后输入 `/qp-weekly` 就能复跑，不用再手打长提示词。

> 灵感来自 @毕方BitFun 的抖音视频「用这个功能，炼化Prompt，一键执行⚡ 避免手打」。原视频展示的是它自家产品里的交互；这里按同样的思路做了一套 DSH 原生实现（命令 + 工具 + 本地库），不是界面复刻。

---

## 功能

| 能力 | 说明 |
| --- | --- |
| **炼化** | `/qp forge <一句粗糙需求>` 调用当前会话模型，重写成带角色、目标、步骤、约束、输出格式的结构化 Prompt |
| **入库** | `/qp save weekly --title=周报` 把最近一次炼化结果存进本地库 |
| **一键执行** | 保存后自动生成 `/qp-weekly`，直接执行，渲染结果作为用户消息送进当前会话并唤醒 Agent |
| **变量** | 模板支持 `{{主题}}` 与 `{{主题:默认值}}`，执行时用 `主题=Q4` 或按顺序传参，只填变化的部分 |
| **Agent 共用** | 模型可通过 `quick_prompt` 工具读、写、删、运行同一个库 |
| **可调** | 命令前缀、是否自动执行、炼化用的 system prompt / 模型、库路径等都在配置里 |

## 安装

要求：DSH Desktop / DSH 0.2.x（`@deepseek-ai/dsh-commands` 提供斜杠命令）。

```text
plugin_manager
  action: install_bundle
  target: D:\WorkSpace\DSHworkspace\QuickPrompt   # 本仓库的绝对路径
```

`install_bundle` 会把本目录链接进当前 profile 并启用 bundle；返回 `application: applied` 即生效。仓库根目录就是插件包根目录（`package.json` 中声明了 `dsh.bundle.patch`），不依赖任何第三方 npm 包。

> 安装 `plugin_manager` 会要求审批（approval=ask），属于正常现象。

## 使用

```
/qp                          查看帮助
/qp list                     列出已保存的提示词
/qp forge 帮我写一份周报，给老板看   → 返回炼化后的结构化 Prompt
/qp save weekly --title=周报    → 保存，得到 /qp-weekly
/qp-weekly 主题="Q4 复盘"       → 一键执行
/qp show weekly              查看原文与变量
/qp rm weekly --yes          删除
/qp path                     显示库文件位置
```

变量规则：

- `{{主题}}` 必填，缺了会拒绕发送并列出缺哪些；
- `{{主题:默认值}}` 可省略；
- `\{{` 是对的转义，表示字面量 `{{`；
- 参数 `主题="Q4 复盘"` 带空格要加引号；也可以按模板里出现的顺序直接给值；
- 模板没有变量时，多出来的参数会作为补充上下文追加到 Prompt 末尾。

炼化结果会按会话暂存，「保存」时不需要再把 Prompt 复制回来。

## 配置

插件行 id 是 `quickprompt`。在 profile 的 `cordis.patch.yml` 里覆盖 config 即可：

```yaml
- override:
    id: quickprompt
    config:
      commandPrefix: qp          # 命令前缀（必须匹配 ^[a-z][a-z0-9_-]*$）
      autoRun: true              # /qp-<slug> 是否立即发送；false 时只回显文本
      maxPromptChars: 8000       # 单个 Prompt 上限
      maxPromptCommands: 50      # 最多生成多少条动态命令
      libraryPath: ''            # 留空 = %DSH_HOME%/quickprompt/prompts.json
      # forgeSystemPrompt: ...   # 自定义炼化指令
      # forgeModel: { provider: deepseek-official, model: deepseek-flash }
```

## 数据

默认库文件：`%DSH_HOME%\quickprompt\prompts.json`（macOS/Linux 为 `~/.dsh/quickprompt/prompts.json`）。

人类可读的 JSON，可直接用编辑器改。写入是「临时文件 + rename」的原子替换；文件损坏时会被重命名为 `prompts.json.corrupt-<时间戳>` 而不是直接丢弃。卸载插件不会删除库文件。

## 开发

```powershell
node test/render.test.js   # 模板 / 参数 / 存储的纯函数测试
node test/plugin.test.js   # 用假 Host 跑通 forge → save → 动态命令 → 发送
```

`node --test test/` 也可以，但在沙箱化的 DSH 会话里它需要 spawn 子进程（Windows 沙箱会报 `spawn EPERM`），所以 npm script 直接运行测试文件。

结构：

```
index.js          Host 侧：命令、工具、炼化、发送
lib/render.js     模板解析 / 渲染 / 参数绑定（纯函数）
lib/store.js      JSON 库（原子写、损坏备份）
lib/forge.js      炼化指令与流式聚合
test/             单元 + 集成测试
```

## 已知限制 / Roadmap

- 目前只有斜杠命令入口，没有图形面板。DSH 的 Web 插件宿主端 RPC（客户端 `host.call` 对应的 Host 注册面）没有公开文档，未在本版本验证；确认后再补「输入框下方快捷面板」。
- 动态命令名必须是 ASCII（`@deepseek-ai/dsh-commands` 的 `^[a-z][a-z0-9_-]*$` 约束），所以 `slug` 用英文，中文放在 `title` 里。
- 炼化是一次独立的模型调用，不继承会话上下文，这样保存下来的 Prompt 才能独立复用。

## License

MIT © 2026 wyylalala
