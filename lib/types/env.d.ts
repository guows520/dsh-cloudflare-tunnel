/**
 * First-run environment template management for the Cloudflare Tunnel plugin.
 * @module @deepseek-ai/dsh-cloudflare-tunnel/env
 */
/** User-editable `.env` template. Every setting is commented out by default. */
export declare const ENV_TEMPLATE: string;
/** Resolve the DSH environment file path. */
export declare function envFilePath(env?: NodeJS.ProcessEnv): string;
/**
 * Create the commented template when `.env` does not exist. An existing file is
 * never modified, so user credentials and host-specific settings are preserved.
 */
export declare function ensureEnvTemplate(env?: NodeJS.ProcessEnv): Promise<"created" | "exists">;
