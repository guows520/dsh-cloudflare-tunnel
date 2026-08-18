# DSH Cloudflare Tunnel

这个插件把 DeepSeek Harness Desktop 的 Web 服务固定在本机 `127.0.0.1:3080`，并由桌面应用启动 `cloudflared`，使手机或外网浏览器能够通过自己的 HTTPS 子域名访问 DSH。它不修改官方安装目录，也不需要将本机端口暴露到局域网或公网。

适用对象：Windows 上的 DeepSeek Harness Desktop 用户。每台电脑使用自己的 Cloudflare Tunnel、Tunnel token 和子域名，例如 `pc1.example.com`、`pc2.example.com`。

当前发布包以 DeepSeek Harness Desktop `0.1.0-rc.5` 的公开 Profile/Bundle 接口验证。升级桌面应用后，先在本机重启并确认本地页面可打开；如出现插件加载错误，请查看本仓库的兼容版本或提 Issue，并附上 `dsh --version` 与错误文本，不要附上 Tunnel token。

## 工作方式

```text
手机或外网浏览器
        |
https://pc1.example.com
        |
Cloudflare HTTPS edge
        |
Cloudflare Tunnel
        |
cloudflared (由 DSH 插件管理)
        |
http://127.0.0.1:3080
        |
DeepSeek Harness Desktop
```

插件只监听回环地址。Cloudflare 是唯一的远程入口。关闭 DeepSeek Harness 时，插件会停止 `cloudflared`；本项目不会安装 Windows 服务。

## 前置条件

1. 已安装并至少启动过一次 DeepSeek Harness Desktop。
2. 拥有一个已托管到 Cloudflare 的域名。域名的权威 DNS 必须使用 Cloudflare nameserver。
3. 拥有 Cloudflare Zero Trust 的访问权限。
4. （可选）已安装 `cloudflared`。v0.2.0 起插件会自动检测 `PATH` 中的 `cloudflared`，未检测到时自动下载固定版本安装到 `%USERPROFILE%\.dsh\bin\`，见下文“cloudflared 自动安装”。

如果想手动安装，Windows 可以运行：

```powershell
winget install --id Cloudflare.cloudflared
```

安装完成后重新打开 PowerShell，并验证：

```powershell
cloudflared --version
```

如果既不想把 `cloudflared.exe` 加入 `PATH`，也不想让插件自动安装，请记住它的绝对路径，例如 `C:\Users\Alice\cloudflared\cloudflared.exe`，并配置为 `CLOUDFLARED_PATH`。

### cloudflared 自动安装

插件启动 Tunnel 时按以下顺序解析 `cloudflared` 可执行文件：

1. `CLOUDFLARED_PATH` 指定的绝对路径或命令名。显式指定的路径不会触发自动安装。
2. `PATH` 中的 `cloudflared`。
3. `%USERPROFILE%\.dsh\bin\cloudflared.exe` 自动管理副本；不存在时自动下载。

自动安装会从 Cloudflare 官方 GitHub Releases 下载固定版本 `2026.8.2`（`cloudflared-windows-amd64.exe`），校验 SHA-256（完整校验和见 `src/installer.ts`）通过后才落盘到 `%USERPROFILE%\.dsh\bin\cloudflared.exe`；校验失败会删除临时下载文件并报错。下载不修改系统 `PATH`，不安装系统服务，不需要管理员权限。

如需禁用自动安装，在 `%USERPROFILE%\.dsh\.env` 中设置：

```env
CLOUDFLARE_AUTO_INSTALL=false
```

禁用后若找不到 `cloudflared`，插件会报错且不启动 Tunnel。

## Cloudflare 配置

下面的 Cloudflare 配置每台电脑只做一次。示例将电脑命名为 `pc1`，域名为 `example.com`；请替换成自己的值。

### 1. 创建 Tunnel

1. 登录 [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)。
2. 打开 `Networks` -> `Tunnels`。
3. 选择 `Create a tunnel`。
4. 选择 `Cloudflared`，Tunnel 名称填写 `dsh-pc1`。
5. 创建后，进入该 Tunnel 的安装页面，复制 Windows 命令中 `--token` 后面的完整 token。

不要执行页面中的 `cloudflared service install ...`。本插件会在 DeepSeek Harness 启动时管理 `cloudflared` 进程。

### 2. 绑定公网子域名

1. 在刚创建的 Tunnel 中打开 `Public Hostnames`。
2. 选择 `Add a public hostname`。
3. 填写：

| 字段 | 示例值 |
| --- | --- |
| Subdomain | `pc1` |
| Domain | `example.com` |
| Type | `HTTP` |
| URL | `localhost:3080` |

4. 保存。

Cloudflare 会为 `pc1.example.com` 创建关联 Tunnel 的代理 DNS 记录。不要手动把这个名称指向家庭公网 IP、内网 IP 或 `127.0.0.1`。

### 3. 可选：启用 Cloudflare Access

裸露的 DSH 实例拥有你的会话和工作区访问能力。强烈建议为每个子域名创建 Access 应用：

1. 在 Zero Trust 中打开 `Access` -> `Applications` -> `Add an application`。
2. 选择 `Self-hosted`。
3. Application domain 填写 `pc1.example.com`。
4. 新建 Allow policy，只允许自己的邮箱地址、邮箱域、身份提供商组或一次性 PIN 登录。
5. 保存并用无痕窗口访问该域名，确认 DSH 页面之前先出现 Cloudflare Access 登录页。

插件不验证 Access JWT。访问控制完全由 Cloudflare Access 负责。

## 安装插件

### 方式一：Windows 一键安装

这是推荐方式，不需要 Node.js、pnpm，也不修改官方应用文件。

1. 从本 GitHub 仓库下载 Release 压缩包，或克隆仓库：

```powershell
git clone https://github.com/guows520/dsh-cloudflare-tunnel.git
cd dsh-cloudflare-tunnel
```

2. 运行安装脚本。脚本会提示粘贴 Tunnel token，输入时不会在控制台回显：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-windows.ps1 -Hostname pc1.example.com
```

如果 `cloudflared.exe` 不在 `PATH`：

```powershell
.\install-windows.ps1 -Hostname pc1.example.com -CloudflaredPath 'C:\Users\Alice\cloudflared\cloudflared.exe'
```

3. 重启 DeepSeek Harness Desktop。
4. 用手机关闭 Wi-Fi、改用移动数据，访问：

```text
https://pc1.example.com
```

安装脚本会进行以下操作：

- 复制运行时包到 `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-cloudflare-tunnel`。
- 将 bundle 注册到 `%USERPROFILE%\.dsh\profiles\web\package.json`。这个目录正是官方 Desktop 的 Profile 模块解析目录，不需要执行 `pnpm install`。
- 在 `%USERPROFILE%\.dsh\.env` 写入 hostname 和 `cloudflared` 路径。
- 在 `%USERPROFILE%\.dsh\.credentials.yaml` 写入 Tunnel token。

`CLOUDFLARE_TUNNEL_TOKEN` 是机密。不要提交 `.credentials.yaml`，不要发送给他人，也不要粘贴到 `cordis.patch.yml` 或 GitHub Issue。

### 方式二：通过 DSH 命令行安装

此方式适合已安装 Node.js 和 pnpm，并且能运行 DSH 的 `dsh plugin` 命令的用户：

```powershell
dsh plugin --profile web add github:guows520/dsh-cloudflare-tunnel
```

注意：当前桌面版的“插件配置”页只为内置插件提供配置卡片，第三方 bundle 无法在那里注册设置卡片，这是官方目前的限制（`@deepseek-ai/dsh-client-ui-settings-plugins` 的 README 明确说明：配置是否暴露给浏览器由 Host 的 api-proxy 允许列表决定，官方仓库之外的插件无法把自己的配置暴露到该页面）。因此方式二安装后仍需手动写配置到 `%USERPROFILE%\.dsh\.env`：

v0.2.1 起，首次启动安装了本插件的 DSH 时，如果 `%USERPROFILE%\.dsh\.env` 不存在，插件会自动创建一份全部注释掉的模板，并在其中写明每个配置项的作用、示例值以及 token 的正确存放位置。已有 `.env` 不会被修改。自动创建只影响文件本身；由于 DSH 读取环境变量发生在启动早期，创建或修改后都需要重启 DSH 才会生效。

```env
CLOUDFLARE_TUNNEL_HOSTNAME=pc1.example.com
CLOUDFLARED_PATH=C:\Users\Alice\cloudflared\cloudflared.exe
```

`cloudflared` 已加入 `PATH`，或愿意让插件自动下载安装（默认行为）时，可省略 `CLOUDFLARED_PATH`。“插件列表”页只用于确认插件挂载状态，不能在其中配置参数。修改配置后重启桌面应用即可生效。

如果安装后还没有配置 hostname，插件会在启动时记录一条 `hostname is not configured` 警告并跳过 Tunnel，本地功能不受影响；配置完成并重启后 Tunnel 才会启动。

Tunnel token 属于机密凭据，桌面应用界面无法配置，仍需手动写入 `%USERPROFILE%\.dsh\.credentials.yaml`：

```yaml
CLOUDFLARE_TUNNEL_TOKEN: '粘贴 Cloudflare Tunnel token'
```

重启桌面应用。

## 多电脑规则

每台电脑配置一组独立资源：

| 电脑 | Tunnel | 子域名 | 本地端口 |
| --- | --- | --- | --- |
| 电脑 1 | `dsh-pc1` | `pc1.example.com` | `3080` |
| 电脑 2 | `dsh-pc2` | `pc2.example.com` | `3080` |

不同电脑都使用 `3080` 没有冲突，因为该端口只在各自电脑的回环网络栈中监听。不能让两台不同电脑共用同一个 hostname 或同一个 Tunnel token，否则 Cloudflare 不知道请求应转发到哪台电脑，连接会不稳定或路由到错误设备。

同一台电脑不能同时运行两个启用了此插件的 DeepSeek Harness 实例：第二个实例无法绑定 `127.0.0.1:3080`。先关闭旧实例再重新启动。

## 验证与排错

重启 DeepSeek Harness 后，在这台电脑的 PowerShell 运行：

```powershell
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 3080
curl.exe -I http://127.0.0.1:3080
Get-Process cloudflared
```

预期结果：3080 由 DeepSeek Harness 的后端监听；本地 HTTP 请求返回 `200 OK`；`cloudflared` 进程存在。

| 症状 | 检查与处理 |
| --- | --- |
| 手机显示 502 | 先确认 `http://127.0.0.1:3080` 返回 200。再确认 Public Hostname 的 Service URL 是 `http://localhost:3080`。 |
| 浏览器显示 `ERR_CONNECTION_CLOSED` | 在 Cloudflare DNS 中确认该 hostname 的 Public Hostname 已保存。公共 DNS 不应返回 NXDOMAIN。若本机使用 Clash fake-IP，请用手机移动数据验证。 |
| DSH 启动失败，提示端口占用 | 运行 `Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 3080` 找到占用进程；关闭它或关闭另一份 DSH。 |
| 提示找不到 cloudflared | 运行 `cloudflared --version`。若未加入 PATH，重新运行安装脚本并传入 `-CloudflaredPath`。 |
| 日志出现 automatic cloudflared installation ... failed | 自动下载失败。检查网络与 GitHub 连通性，恢复后重启 DSH 重试；或手动下载 `cloudflared.exe` 并设置 `CLOUDFLARED_PATH`。同时确认 `%USERPROFILE%\.dsh\bin\` 目录可写。 |
| 插件没有启动 Tunnel | 日志出现 `hostname is not configured` 时，在 `.env` 设置 `CLOUDFLARE_TUNNEL_HOSTNAME`；否则检查 `.credentials.yaml` 是否包含非空 `CLOUDFLARE_TUNNEL_TOKEN`。改完重启 DSH。 |
| Cloudflare 域名返回 NXDOMAIN | Public Hostname 尚未创建、域名未托管到 Cloudflare，或记录尚未生效。回到 Tunnel 的 `Public Hostnames` 检查 hostname。 |

## 更新与卸载

更新：下载新版仓库后，从新版目录再次运行 `install-windows.ps1`。脚本会覆盖 profile 中的插件运行时文件，并保留同一份 hostname 和 token 配置。

方式二安装的用户：直接重新运行 `dsh plugin --profile web add github:guows520/dsh-cloudflare-tunnel` 即可更新，pnpm 会重新解析 GitHub 仓库的最新提交并覆盖安装；`.env` 与 `.credentials.yaml` 里的配置不受影响。更新前关闭 DeepSeek Harness，更新后重启。

卸载：关闭 DeepSeek Harness，删除 `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-cloudflare-tunnel`，然后从 `%USERPROFILE%\.dsh\profiles\web\package.json` 的 `dsh.profile.bundles` 中移除 `dsh-cloudflare-tunnel`。需要彻底清理时，再删除 `.env` 中的 `CLOUDFLARE_TUNNEL_HOSTNAME`、`CLOUDFLARED_PATH`、`.credentials.yaml` 中的 `CLOUDFLARE_TUNNEL_TOKEN`，以及插件自动安装的 `%USERPROFILE%\.dsh\bin\cloudflared.exe`。

## 开发说明

发布包携带预构建 `lib/`，普通安装不运行构建。源代码基于 DeepSeek Harness 的 Cordis 插件接口；若修改 `src/`，请在与目标 DSH 版本匹配的 DeepSeek Harness 工作区中执行类型检查、单元测试和打包，再更新 `lib/`。

本项目不是 DeepSeek 或 Cloudflare 的官方插件。
