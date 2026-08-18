/**
 * Pinned cloudflared release management. When the executable is not found on
 * PATH, the plugin can download the pinned official Windows amd64 build into
 * `$DSH_HOME/bin` and verify its SHA-256 before use.
 * @module @deepseek-ai/dsh-cloudflare-tunnel/installer
 */
/** Pinned upstream release the automatic installer downloads. */
export declare const CLOUDFLARED_VERSION = "2026.8.2";
/** SHA-256 of the pinned `cloudflared-windows-amd64.exe` release asset. */
export declare const CLOUDFLARED_SHA256 = "c29eee2b121f5436a642eed69fd9767da7e7b8c510fa50aaa130337f931357b5";
/** Official release asset URL for the pinned version. */
export declare const CLOUDFLARED_DOWNLOAD_URL: string;
/** Absolute path of the plugin-managed cloudflared copy under `$DSH_HOME/bin`. */
export declare function managedCloudflaredPath(env?: NodeJS.ProcessEnv): string;
/** Resolve `$DSH_HOME`, falling back to `~/.dsh` like the DSH host. */
export declare function dshHomePath(env?: NodeJS.ProcessEnv): string;
/** Stream a file's SHA-256 without loading it whole. */
export declare function sha256File(path: string): Promise<string>;
/**
 * Download `url` to `target` atomically, verifying the SHA-256 on the way.
 * The payload lands in `target.part` first; a mismatch or transport failure
 * removes the partial file and leaves `target` untouched.
 */
export declare function downloadAndVerify(url: string, target: string, expectedSha256: string): Promise<void>;
/**
 * Return the managed cloudflared path, downloading and verifying the pinned
 * release first when the copy is absent or fails its checksum.
 * @param expectedSha256 - checksum to enforce; defaults to the pinned release.
 */
export declare function ensureManagedCloudflared(expectedSha256?: string): Promise<string>;
