import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dshHomePath } from "./installer.js";
//#region lib/types/env.js
/**
* First-run environment template management for the Cloudflare Tunnel plugin.
* @module @deepseek-ai/dsh-cloudflare-tunnel/env
*/
/** User-editable `.env` template. Every setting is commented out by default. */
const ENV_TEMPLATE = `# DeepSeek Harness 环境变量文件
# 由 dsh-cloudflare-tunnel 首次启动时生成。
# 去掉要启用配置行开头的 #，填写自己的值，然后重启 DSH。

# 必填：Cloudflare Zero Trust 中创建的公网子域名。
# 示例：CLOUDFLARE_TUNNEL_HOSTNAME=pc1.example.com

# 可选：自己安装的 cloudflared.exe 绝对路径。
# cloudflared 已在 PATH 中，或使用自动安装时，可保持注释。
# 示例：CLOUDFLARED_PATH=C:\\Users\\Alice\\cloudflared\\cloudflared.exe

# 可选：设为 false 可禁用 cloudflared 自动安装。
# 示例：CLOUDFLARE_AUTO_INSTALL=false

# 请不要把 CLOUDFLARE_TUNNEL_TOKEN 写入这个文件。
# Tunnel token 请写入同目录的 .credentials.yaml。
`;
/** Resolve the DSH environment file path. */
function envFilePath(env = process.env) {
	return join(dshHomePath(env), ".env");
}
/**
* Create the commented template when `.env` does not exist. An existing file is
* never modified, so user credentials and host-specific settings are preserved.
*/
async function ensureEnvTemplate(env = process.env) {
	const path = envFilePath(env);
	await mkdir(dirname(path), { recursive: true });
	try {
		await writeFile(path, ENV_TEMPLATE, { encoding: "utf8", flag: "wx" });
		return "created";
	} catch (error) {
		if (isFileExistsError(error)) return "exists";
		throw error;
	}
}
function isFileExistsError(error) {
	return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
//#endregion
export { ENV_TEMPLATE, ensureEnvTemplate, envFilePath };
