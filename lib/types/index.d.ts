/**
 * Optional Cloudflare Tunnel function plugin. When enabled, resolves the
 * device-specific tunnel token through the credentials seam and launches
 * `cloudflared tunnel run --token` as a managed subprocess, exposing the
 * local DSH web server on a per-device hostname. Disposal terminates the
 * tunnel process and awaits its exit.
 * @module @deepseek-ai/dsh-cloudflare-tunnel
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import '@deepseek-ai/dsh-subprocess';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "cloudflare-tunnel";
/** Services the plugin requires before it can run. */
export declare const inject: string[];
/** Credential reference holding the device-specific tunnel token. */
export declare const TOKEN_CREDENTIAL_REF: import("@deepseek-ai/dsh-credentials").CredentialRef;
/** Plugin configuration; invalid hostnames fail loud at load. */
export interface Config {
    /** Whether the tunnel starts; remote access is opt-in. */
    enabled: boolean;
    /** Device-specific public hostname the tunnel serves. */
    hostname: string;
    /** Local TCP port the tunnel forwards to. */
    localPort: number;
    /** Absolute cloudflared path or bare PATH name. */
    cloudflaredPath: string;
}
/** Schemastery validation for {@link Config}. */
export declare const Config: z<Config>;
/**
 * Start the tunnel for this fiber's lifetime when enabled.
 * Failure modes: a missing cloudflared binary or invalid hostname throws
 * (plugin load fails loud); an unconfigured token warns and skips the spawn
 * so the host keeps running without remote access.
 * @param ctx - plugin context owning the subprocess and effects.
 * @param config - resolved tunnel configuration.
 * @returns a disposer that terminates the tunnel process and awaits its exit.
 */
export declare function apply(ctx: Context, config: Config): Promise<() => Promise<void>>;
//# sourceMappingURL=index.d.ts.map