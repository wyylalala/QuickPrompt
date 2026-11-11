# 发布与上架

QuickPrompt 对外有两件事要做：发 npm 包、进市场目录。各一份 checklist，按顺序勾。

> **当前状态：两份都尚未执行。** npm 还没登录过，包也没发；awesome-dsh-plugin 还没收录，所以 dshmarket 里搜不到 QuickPrompt。下面写的是操作流程，不代表已经完成。

- 包名：`dsh-quickprompt`（README 里暂不加 npm 徽章）
- 仓库：<https://github.com/wyylalala/QuickPrompt>
- 发布前先跑一遍：`node test/render.test.js`、`node test/plugin.test.js`、`npm run check:leaks`

---

## 一、npm 发布

前置：Node 24、npm 账号有公开发布权限、工作区干净（发布内容以 `package.json` 的 `files` 为准）。

- [ ] **登录 npm**

  ```sh
  npm login
  ```

- [ ] **去掉私有标记**：从 `package.json` 删除 `"private": true`（不删的话 `npm publish` 会直接拒绝）。

- [ ] **确认 `files` 覆盖发布内容**。当前至少要包含：

  - `index.js`、`lib/*.js`
  - `client.js`（插件页面板，Web 宿主加载）
  - `cordis.patch.yml`
  - `locale/*.json`
  - `icon.svg`
  - `assets/`（README 和面板示意图用的 SVG；缺了 GitHub 上图片裂开）
  - `README.md`、`README.en.md`、`LICENSE`

- [ ] **打包预演**：

  ```sh
  npm pack --dry-run
  ```

  逐项核对输出里有 `client.js`、`assets/`、`icon.svg`、`cordis.patch.yml`。缺哪个就回上一步补 `files`，补完再跑一次。

- [ ] **发布**：

  ```sh
  npm publish
  ```

- [ ] **验证已上架**：

  ```sh
  npm view dsh-quickprompt version
  ```

  回显的应是刚发布的版本号；再到 <https://www.npmjs.com/package/dsh-quickprompt> 看一眼 README 渲染是否正常。

- [ ] **打 tag**（由维护者执行，不在本仓库的文档流程里跑）：

  ```sh
  git tag v<version>
  git push origin v<version>
  ```

- [ ] **改 README**（中文版和英文版同步）：

  - 安装小节「npm」一段从「暂未发布」改成：`plugin_manager` 里填 `dsh-quickprompt`，或 `dsh plugin --profile <profile> add dsh-quickprompt`；
  - 加 npm 徽章：

    ```markdown
    [![npm](https://img.shields.io/npm/v/dsh-quickprompt)](https://www.npmjs.com/package/dsh-quickprompt)
    ```

  - 删掉「npm 暂未发布，发布会写进 docs/RELEASING.md」这类句子；
  - 路线图里把「npm 发布」标成已完成。

---

## 二、市场收录（awesome-dsh-plugin → dshmarket）

前提：仓库是公开的，且能被对方校验脚本通过。**dshmarket 只允许安装精选目录（awesome-dsh-plugin）内的来源**，没收录就搜不到、也装不了。

- [ ] **克隆目录仓库**（浅克隆就够）：

  ```sh
  git clone --depth 1 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
  ```

- [ ] **读规则**：先看仓库根目录的 `contributing.md`，确认当前字段、分类名和校验命令。字段会变，以仓库里的说明为准。

- [ ] **抄模板**：打开 `data/plugins/` 下任意一个 YAML，照着它的字段结构写。常见字段：

  `name`、`owner`、`url`、`category`、`description.en`、`description.zh`、`install`、`icon`、`npm`

- [ ] **新建条目** `data/plugins/wyylalala__QuickPrompt.yml`，内容形如：

  ```yaml
  name: QuickPrompt
  owner: wyylalala
  url: https://github.com/wyylalala/QuickPrompt
  category: productivity        # 以目录当前分类表为准，不要照抄这里
  description:
    en: Forge a rough request into a structured prompt, save it as /qp-<slug>, run it again in one command.
    zh: 把一句口语需求炼化成结构化 Prompt，存成 /qp-<slug> 快捷命令，一键复跑。
  install:
    # npm 发布前只能给 GitHub 源码；发布后改成 npm 包名
    github: wyylalala/QuickPrompt
    # npm: dsh-quickprompt
  icon: https://raw.githubusercontent.com/wyylalala/QuickPrompt/main/icon.svg
  ```

  写完对照模板检查缩进和必填项（尤其是 `description` 的中英双语与 `install` 来源）。

- [ ] **跑对方仓库的校验**：用 `contributing.md` 里写的命令（通常是根目录 `scripts/` 下的校验脚本，或 `npm test` / `pnpm validate`）。报错就按提示改 YAML，不要跳过。

- [ ] **提 PR**：标题写清楚新增条目，描述里贴一段 README 摘要或 `assets/banner.svg`。留意 CI 和 reviewer 的修改意见。

- [ ] **等目录重建**：合并后目录会重新生成索引，需要等下一次构建完成。

- [ ] **验收录**：在 dshmarket 里搜「QuickPrompt」，检查卡片名称、描述、DSH 版本要求、图标和安装按钮；再实际装一次确认来源正确。

- [ ] **收尾**：README（中英）路线图里把「市场收录」标成已完成。

---

## 备注

- npm 包名发布后不要改，改了旧安装会失效；若必须改，另发新名并在 README 里说明迁移。
- 两个流程都不需要改插件代码；如果发布时发现 `files` 漏了文件，改 `package.json` 后重新 `npm pack --dry-run` 再发。
- 发布相关命令由维护者在本地执行，仓库本身不保存任何 token、账号或密钥。
