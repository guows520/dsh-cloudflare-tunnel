/**
 * Optional Cloudflare Tunnel function plugin. When enabled, resolves the
 * device-specific tunnel token through the credentials seam and launches
 * `cloudflared tunnel run --token` as a managed subprocess, exposing the
 * local DSH web server on a per-device hostname. Disposal terminates the
 * tunnel process and awaits its exit.
 * @module @deepseek-ai/dsh-cloudflare-tunnel
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import '@deepseek-ai/dsh-subprocess'
import { CLOUDFLARED_VERSION, ensureManagedCloudflared, managedCloudflaredPath } from './installer.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'cloudflare-tunnel'

/** Services the plugin requires before it can run. */
export const inject = ['subprocess', 'credentials']

/** Credential reference holding the device-specific tunnel token. */
export const TOKEN_CREDENTIAL_REF = credentialRef('CLOUDFLARE_TUNNEL_TOKEN')

/**
 * Loose FQDN shape: dot-separated DNS labels with at least one dot, no
 * whitespace, bounded total length. Startup-time validation only; the value
 * is never hot-reloaded.
 */
const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

/** Plugin configuration; invalid hostnames fail loud at load. */
export interface Config {
  /** Whether the tunnel starts; remote access is opt-in. */
  enabled: boolean
  /** Device-specific public hostname; may be absent until configured. */
  hostname: string
  /** Local TCP port the tunnel forwards to. */
  localPort: number
  /** Absolute cloudflared path or bare PATH name. */
  cloudflaredPath: string
  /** Download the pinned cloudflared into $DSH_HOME/bin when not on PATH. */
  autoInstall: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  hostname: z.string(),
  localPort: z.number().min(1).max(65535).default(3080),
  cloudflaredPath: z.string().default('cloudflared'),
  autoInstall: z.boolean().default(true),
})

/** Grace period for the terminate escalation on the tunnel process. */
const TERMINATE_GRACE_MS = 5_000
/** Retained stderr tail for unexpected-exit diagnostics. */
const STDERR_COLLECT_BYTES = 4_096

/** Validate a non-empty hostname as a plausible FQDN for the tunnel route. */
function assertValidHostname(hostname: string): void {
  if (/\s/.test(hostname)) {
    throw new TypeError(`cloudflare-tunnel: hostname "${hostname}" must not contain whitespace`)
  }
  if (hostname.length > 253 || !HOSTNAME_PATTERN.test(hostname)) {
    throw new TypeError(`cloudflare-tunnel: hostname "${hostname}" is not a valid fully qualified domain name`)
  }
}

/**
 * Bare PATH name used as the config default; auto-install applies only to it.
 */
const DEFAULT_CLOUDFLARED_PATH = 'cloudflared'

/**
 * Resolve the cloudflared executable. The configured value wins (PATH name or
 * absolute path); when only the default bare name is configured and it is not
 * on PATH, the pinned release is installed into `$DSH_HOME/bin` on first use
 * unless `autoInstall` is disabled.
 */
async function resolveCloudflaredExecutable(ctx: Context, config: Config): Promise<string> {
  try {
    return await ctx.subprocess.resolveExecutable(config.cloudflaredPath)
  } catch (error) {
    const explicit = config.cloudflaredPath !== DEFAULT_CLOUDFLARED_PATH
    if (explicit || !config.autoInstall) {
      throw new Error(
        `cloudflare-tunnel: cannot find the cloudflared executable "${config.cloudflaredPath}". `
        + 'Install cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) '
        + 'or set cloudflaredPath to its absolute path.',
        { cause: error },
      )
    }
  }
  const target = managedCloudflaredPath()
  ctx.logger.info(
    'cloudflare-tunnel: cloudflared not found on PATH; installing %s to %s',
    CLOUDFLARED_VERSION,
    target,
  )
  try {
    return await ensureManagedCloudflared()
  } catch (error) {
    throw new Error(
      `cloudflare-tunnel: automatic cloudflared installation to "${target}" failed: ${String(error)}. `
      + 'Install cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) '
      + 'or set cloudflaredPath to its absolute path.',
      { cause: error },
    )
  }
}

/**
 * Start the tunnel for this fiber's lifetime when enabled.
 * Failure modes: a malformed hostname throws (plugin load fails loud); an
 * unresolvable cloudflared binary either auto-installs the pinned release
 * into `$DSH_HOME/bin` (default) or throws when `autoInstall` is off or a
 * custom path was configured; an unconfigured hostname or token warns and
 * skips the spawn so the host keeps running without remote access.
 * @param ctx - plugin context owning the subprocess and effects.
 * @param config - resolved tunnel configuration.
 * @returns a disposer that terminates the tunnel process and awaits its exit.
 */
export async function apply(ctx: Context, config: Config): Promise<() => Promise<void>> {
  if (!config.enabled) {
    return () => Promise.resolve()
  }
  // A missing hostname means this device was never configured; skip like an
  // unconfigured token instead of failing the whole DSH boot.
  if (typeof config.hostname !== 'string' || config.hostname.length === 0) {
    ctx.logger.warn(
      'cloudflare-tunnel: hostname is not configured; tunnel not started. '
      + 'Set CLOUDFLARE_TUNNEL_HOSTNAME in your .dsh/.env file, then restart.',
    )
    return () => Promise.resolve()
  }
  assertValidHostname(config.hostname)

  const resolved = await ctx.credentials.resolve(TOKEN_CREDENTIAL_REF)
  if (resolved === undefined) {
    ctx.logger.warn(
      'cloudflare-tunnel: credential "%s" is not configured; tunnel not started',
      String(TOKEN_CREDENTIAL_REF),
    )
    return () => Promise.resolve()
  }

    const executable = await resolveCloudflaredExecutable(ctx, config)

  // The token travels on the command line: ctx.subprocess scrubs
  // credential-shaped environment names, and cloudflared accepts no stdin
  // token channel.
  const handle = ctx.subprocess.spawn({
    argv: [executable, 'tunnel', 'run', '--token', resolved.value],
    cwd: process.cwd(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 1 },
      stderr: { maxBytes: STDERR_COLLECT_BYTES },
    },
    graceMs: TERMINATE_GRACE_MS,
  })
  ctx.logger.info('cloudflare-tunnel: started for %s -> 127.0.0.1:%d', config.hostname, config.localPort)

  // Unexpected exit: publish the disconnected state and log; never restart.
  void handle.done.then((outcome: SubprocessOutcome) => {
    const tail = handle.collected.stderr?.readFrom(0).text.trim()
    ctx.logger.warn(
      'cloudflare-tunnel: cloudflared exited unexpectedly (code %s%s)',
      String(outcome.exitCode ?? outcome.signal),
      tail === '' ? '' : `: ${tail}`,
    )
  }, () => {
    // Spawn-level failure already surfaced through resolveExecutable/successful
    // spawn; a rejection here is the same unexpected-exit surface.
  })

  let disposed = false
  return async () => {
    if (disposed) return
    disposed = true
    // Stop the published state first, then terminate and reach quiescence.
    handle.terminate()
    await handle.waitForExit()
  }
}
