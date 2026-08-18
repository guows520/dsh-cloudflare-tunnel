import { createHash } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
//#region lib/types/installer.js
/**
* Pinned cloudflared release management. When the executable is not found on
* PATH, the plugin can download the pinned official Windows amd64 build into
* `$DSH_HOME/bin` and verify its SHA-256 before use.
* @module @deepseek-ai/dsh-cloudflare-tunnel/installer
*/
/** Pinned upstream release the automatic installer downloads. */
const CLOUDFLARED_VERSION = "2026.8.2";
/** SHA-256 of the pinned `cloudflared-windows-amd64.exe` release asset. */
const CLOUDFLARED_SHA256 = "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5";
/** Official release asset URL for the pinned version. */
const CLOUDFLARED_DOWNLOAD_URL = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`;
/** Absolute path of the plugin-managed cloudflared copy under `$DSH_HOME/bin`. */
function managedCloudflaredPath(env = process.env) {
	const home = dshHomePath(env);
	const binary = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
	return join(home, "bin", binary);
}
/** Resolve `$DSH_HOME`, falling back to `~/.dsh` like the DSH host. */
function dshHomePath(env = process.env) {
	const configured = env.DSH_HOME?.trim();
	return configured && configured.length > 0 ? configured : join(homedir(), ".dsh");
}
/** Stream a file's SHA-256 without loading it whole. */
async function sha256File(path) {
	const handle = await open(path, "r");
	try {
		const hash = createHash("sha256");
		const chunk = Buffer.alloc(65536);
		for (;;) {
			const { bytesRead } = await handle.read(chunk);
			if (bytesRead === 0) break;
			hash.update(chunk.subarray(0, bytesRead));
		}
		return hash.digest("hex");
	} finally {
		await handle.close();
	}
}
/**
* Download `url` to `target` atomically, verifying the SHA-256 on the way.
* The payload lands in `target.part` first; a mismatch or transport failure
* removes the partial file and leaves `target` untouched.
*/
async function downloadAndVerify(url, target, expectedSha256) {
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok || response.body === null) throw new Error(`cloudflare-tunnel: download failed with HTTP ${response.status} for ${url}`);
	const part = `${target}.part`;
	const hash = createHash("sha256");
	const handle = await open(part, "w");
	try {
		const reader = response.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			hash.update(value);
			await handle.write(value);
		}
	} catch (error) {
		await handle.close().catch(() => undefined);
		await rm(part, { force: true }).catch(() => undefined);
		throw error;
	}
	await handle.close();
	const actual = hash.digest("hex");
	if (actual !== expectedSha256) {
		await rm(part, { force: true });
		throw new Error(`cloudflare-tunnel: checksum mismatch for ${url}: expected ${expectedSha256}, got ${actual}`);
	}
	await rm(target, { force: true });
	await rename(part, target);
}
/**
* Return the managed cloudflared path, downloading and verifying the pinned
* release first when the copy is absent or fails its checksum.
* @param expectedSha256 - checksum to enforce; defaults to the pinned release.
*/
async function ensureManagedCloudflared(expectedSha256 = CLOUDFLARED_SHA256) {
	const target = managedCloudflaredPath();
	await mkdir(dirname(target), { recursive: true });
	const present = await stat(target).then((info) => info.isFile(), () => false);
	if (present && (await sha256File(target)) === expectedSha256) return target;
	await downloadAndVerify(CLOUDFLARED_DOWNLOAD_URL, target, expectedSha256);
	return target;
}
//#endregion
export { CLOUDFLARED_DOWNLOAD_URL, CLOUDFLARED_SHA256, CLOUDFLARED_VERSION, downloadAndVerify, dshHomePath, ensureManagedCloudflared, managedCloudflaredPath, sha256File };
