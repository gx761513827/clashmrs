# clashmrs · mihomo / OpenClash `.mrs` 规则集网页更新器

在网页上给 mihomo（OpenClash / Clash.Meta / Clash Verge / FlClash …）的 `.mrs` 规则集**加一条域名或 IP**，
自动归一化 + 校验 → 在浏览器里生成 MRSv1 的 `.mrs` → 用**一次原子提交**同时更新仓库里的 `.txt` 与 `.mrs`。

- 纯前端静态页面：**没有后端**，token 只存在你自己的浏览器里，只发往 `api.github.com`。
- 生成的不是「近似」格式：编码器是 mihomo `convert-ruleset` 的逐字节等价实现（见下面「验证」）。
- 全程可预览：新增/删除/重复/非法条目一目了然，提交前可以先下载 `.mrs` 自己验。

---

## 快速开始

**在线使用**：<https://gx761513827.github.io/clashmrs/>（本仓库已用 GitHub Pages 部署，纯静态、无后端）

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173
pnpm build        # 产出 dist/（可直接丢到 GitHub Pages / Cloudflare Pages / 任意静态托管）
pnpm preview      # 本地预览构建产物：http://127.0.0.1:4173
```

部署到 GitHub Pages：仓库自带的 `.github/workflows/pages.yml` 会在 push 后自动构建并发布（`base` 已设为 `'./'`，放在子路径也能用）；
首次需要在 **Settings → Pages → Source** 选择 **GitHub Actions**，未启用时该工作流会自动跳过而不是失败。

## 三步用法

**第 1 步：准备一个细粒度 PAT**（不要用 classic token，也不要给全仓库权限）

1. GitHub → 右上角头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → Generate new token
2. **Repository access**：只勾 *Only select repositories*，选中你放规则集的那一个仓库
3. **Permissions** → *Repository permissions* → **Contents: Read and write**（其余全部保持 No access）
4. 设置一个较短的有效期，生成后复制 `github_pat_...`，粘进页面第一个输入框

> token 默认只写进当前标签页的 `sessionStorage`，关掉浏览器就没了。只有勾选「把 token 记到本机」才会落到 `localStorage`。

**第 2 步：连接并读取**

填好「用户名 / 仓库 / 分支 / 目录 / 文件名（如 `pt`）」，点**连接并读取**。页面会：

- 优先读 `rule/pt.txt`（保留你自己的注释，便于以后在 GitHub 网页上直接改）；
- 没有 `.txt` 就下载 `rule/pt.mrs` 并**在浏览器里解码**成条目列表；
- 两个都没有则按新文件处理。

**第 3 步：加条目 → 提交**

在快速添加框里输入域名 / IP / URL，回车；或者直接把一整段列表粘进编辑框。检查「变更预览」，填提交信息，
点**提交到 GitHub**。成功后页面会给出 commit 链接、raw 链接、jsDelivr 链接，以及可直接使用的 OpenClash 配置片段。

## OpenClash / mihomo 配置片段

```yaml
rule-providers:
  pt:
    type: http
    behavior: domain        # 必须和生成时一致
    format: mrs             # 必须显式写！mihomo 不会根据文件内容自动识别格式
    url: https://raw.githubusercontent.com/<你>/<仓库>/<分支>/rule/pt.mrs
    path: ./rule_provider/pt.mrs
    interval: 86400
```

规则里引用它：

```yaml
rules:
  - RULE-SET,pt,PROXY
```

两个缓存提醒：

- `raw.githubusercontent.com` 有几分钟的 CDN 缓存，刚提交完立刻拉可能还是旧文件；急着验证可以用
  `https://cdn.jsdelivr.net/gh/<你>/<仓库>@<分支>/rule/pt.mrs`，它回源更快。
- mihomo 侧还有 provider 自身的缓存与 `interval`，强制刷新规则再观察。

## 支持的输入

| 输入 | 结果 |
| --- | --- |
| `example.com` | 只匹配自身 |
| `+.example.com` | 匹配自身 + 所有子域（mihomo 里会展开成 `example.com` 与 `.example.com`） |
| `.example.com` | 只匹配子域 |
| `*.example.com` | 匹配任意单层 |
| `https://user:pass@WWW.Example.com:8443/a/b?q=1` | 取 host → `www.example.com` |
| `example.com:8080` / `example.com/path` | 去端口 / 去路径 → `example.com` |
| `1.2.3.4`、`10.0.0.0/8`、`2001:db8::/32` | IP/CIDR 条目（整份列表走 `ipcidr` 类型） |
| `1.2.3.0-1.2.3.255` | 自动拆成最小 CIDR 集合（`1.2.3.0/24`） |
| `# 注释`、空行、`//` 或 `;` 开头的行 | 忽略 |

约束：

- **域名和 IP 不能放在同一个文件里。** 页面会拦下并提示（mihomo 对不匹配的行只会打日志忽略，属于「看起来加了但不生效」）。
- 非法条目会逐行报错并且**禁止提交**，不会静默丢弃。
- mihomo 只支持 `domain` 与 `ipcidr` 两种 behavior 的 `.mrs`；`classical`（classic 全规则）没有 mrs 编解码，请继续用 text/yaml。

## 安全说明

- token 只出现在发往 `api.github.com` 的 `Authorization` 头里，不进 URL、不进日志、不进错误文案（统一脱敏 `ghp_*` / `github_pat_*`）。
- 页面没有后端、没有第三方脚本、没有分析统计；所有网络请求只有 `api.github.com`。
- 建议永远使用**最小权限 + 短有效期 + 单仓库**的细粒度 PAT；页面也提供「清除 token」按钮。
- 提交是原子的：先把 `.mrs` 与 `.txt` 都上传成 blob，再用 Git Data API 建 tree + commit，最后移动分支引用；
  分支被保护或状态过期时（422）自动重取 head 重试一次。
- 你可以在完全离线的情况下用「下载 .txt / .mrs」按钮，不连接 GitHub 也能生成文件。

## 实现与验证

### `.mrs`（MRSv1）格式

```
[zstd 帧]
magic      4B   "MRS" + 0x01
behavior   1B   0:domain 1:ipcidr（2:classical，mihomo 自己也不支持）
count      8B   int64 BE
extraLen   8B   int64 BE（保留字段，目前恒为 0）
body
  domain:   version(1) + leaves[]uint64 + labelBitmap[]uint64 + labels[]byte（反转域名上的 DAFSA，位图压紧）
  ipcidr:   version(1) + 区间数 + 每段 from/to 各 16 字节 BE（IPv4 写成 ::ffff:a.b.c.d，v4 段整体在 v6 段之前）
```

移植自 `MetaCubeX/mihomo` 的 `rules/provider/mrs_converter.go`、`mrs_reader.go`、`component/trie/domain_set{,_bin}.go`、
`component/cidr/ipcidr_set{,_bin}.go` 与 `go4.org/netipx` 的区间归一化语义。

### 字节级回归（核心证据）

`tests/core/fixtures.test.ts` 拿 **官方 mihomo 转换链真实产出的 `.mrs`** 当 ground truth：

```
解码官方 .mrs → 压紧 → 重新编码  ⇒ 未压缩负载与官方文件逐字节相同
官方 .list 源文件 → 编码          ⇒ 负载逐字节相同，且头部 count 与官方一致
```

覆盖 8 组样例（`geo/geosite/category-ads-all`、`asn/AS1`、`geo/geoip/{private,telegram,google,cn}`、`asn/{AS13335,AS15169}`，
最大一组 9609 条 → 6595 个区间）。

fixture 不写进仓库（`tests/fixtures/` 已 gitignore），用 `pnpm fixtures` 从
[MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) 的 `meta` 分支下载（raw 失败自动回退 jsDelivr）。
感谢上游持续产出这些数据。

### 官方二进制交叉验证（可选）

```bash
pnpm verify:mihomo     # 下载官方 mihomo release 到 tools/，然后：
                       #   1) 我们生成的 .mrs → mihomo 解回规则，集合一致
                       #   2) 官方从同一份 text 生成的 .mrs → 负载与我们的逐字节一致
```

### 端到端（真浏览器，只有 GitHub API 被 mock）

`e2e/happy-path.spec.ts` 在真实 Chromium 里跑四条链路：

1. 连接 → **解码仓库里已有的 `.mrs`** → 快速添加一条 URL → 提交 → 把提交上去的 blob 解回来核对条目；
2. 空白新建 → 点「下载 .mrs」→ 真实下载文件 → 解回来核对（证明浏览器 wasm 编码可用）；
3. 塞入非法条目 → 断言提交按钮禁用**且一条写请求都没发出**；同时断言 token 不出现在页面文本或 URL 里；
4. **读取竞态回归**：把仓库读取故意延迟 1.5 秒，在读取期间就往编辑框里输入 → 断言输入不被加载结果覆盖，
   仓库内容只作为 diff 基准，并出现「为了不丢失输入」的提示（真实 bug，见下）。

> 第 4 条来自一次真实事故：`connect()` 的异步结果返回时会 `setText(加载结果)`，
> 把用户在读取期间输入的内容清空；线上构建响应快所以掩盖了这个 bug，本地 dev server 慢才暴露出来。

## 常用命令

```bash
pnpm dev            # 开发服务器
pnpm build          # 类型检查 + 构建
pnpm preview        # 预览构建产物
pnpm test           # 单元 / 集成 / 字节级回归 / 工作流校验
pnpm typecheck      # 只做类型检查
pnpm fixtures       # 下载官方 .mrs fixture
pnpm e2e            # Playwright 端到端（dev server）
pnpm verify:mihomo  # 官方 mihomo 二进制交叉验证
```

三种 E2E 目标（都不需要改代码）：

```bash
# 1) 本地 dev server（默认）
pnpm e2e

# 2) 本地构建产物本身
$env:E2E_SERVER="preview"; pnpm build; pnpm e2e            # PowerShell

# 3) 线上部署（例如 GitHub Pages）——直连打真实站点，同样 4 条用例
$env:E2E_BASE_URL="https://gx761513827.github.io/clashmrs/"; pnpm e2e

# 网络环境需要显式指定代理时（例如 Clash fake-ip）
$env:E2E_PROXY="http://127.0.0.1:7890"; pnpm e2e
```

## 目录结构

```
src/
  core/      纯逻辑：MRS 容器、域名 DAFSA、IP 区间、条目归一化（不依赖 DOM 与网络，可单测）
  github/    GitHub REST 客户端：raw 读文件、Git Data API 原子提交、错误映射与脱敏
  app/       业务胶水：规则集读写、下载、OpenClash 片段
  workers/   转换 Worker（wasm zstd 在后台线程跑，大列表不卡界面）
  ui/        界面组件
tests/       vitest：core / github / app / fixture 字节级回归 / 官方二进制
e2e/         Playwright 真浏览器用例
scripts/     fixture 下载、官方 mihomo 验证
```

## 已知限制

- 不做后端、不做 GitHub OAuth App、不做定时自动更新（如需 CI 兜底，可在仓库里加一个跑 `mihomo convert-ruleset` 的 Action）。
- 不支持 `classical` 规则集的 `.mrs`（上游格式本身不支持）。
- 不解析 Clash 订阅链接，不生成 geoip/geosite 数据库。
- CIDR 主机位非零（如 `10.0.0.1/24`）**直接报错**，语义比 mihomo 更严格——mihomo 会接受但匹配范围容易反直觉。
- 中文/IDN 域名按 UTF-8 字节编码，与 Go 实现一致；不做自动 punycode 转换（会提示你改用 punycode）。
- 浏览器禁用 WebAssembly 时无法生成 `.mrs`，此时可只用 `.txt` + 官方 mihomo 转换。
- 单个规则集建议 <5MB（Git Data API 没有硬上限，但 base64 会让内存翻倍）。

## 许可

代码尚未指定开源许可，请按你的需要补一个 `LICENSE`。
上游 fixture 数据来自 MetaCubeX/meta-rules-dat（GPL-3.0）与 MetaCubeX/mihomo（GPL-3.0），本项目**不复制**它们的代码与数据，
只按文档化的二进制格式做了独立实现，测试时按需下载上游数据文件。
