/**
 * Unit tests for the cloudflare-tunnel function plugin. The subprocess and
 * credentials services are mocked because cloudflared is not available in CI.
 */

import { describe, expect, it, vi } from 'vitest'
import { apply, Config, name, inject, TOKEN_CREDENTIAL_REF } from '../src/index.ts'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Minimal mock subprocess handle matching the plugin's usage. */
function mockHandle() {
  return {
    collected: { stderr: { readFrom: () => ({ text: '' }) } },
    done: Promise.resolve({ exitCode: 0, signal: undefined }),
    terminate: vi.fn(),
    waitForExit: vi.fn().mockResolvedValue(true),
  }
}

/** Build a mock context sufficient for the plugin's apply(). */
function mockCtx(overrides: {
  resolveExecutable?: (cmd: string) => Promise<string>
  spawn?: (spec: SubprocessSpawnSpec) => ReturnType<typeof mockHandle>
  credentials?: { resolve: (ref: unknown) => Promise<{ value: string } | undefined> }
} = {}) {
  const handle = mockHandle()
  return {
    ctx: {
      credentials: overrides.credentials ?? { resolve: vi.fn().mockResolvedValue({ value: 'test-tunnel-token' }) },
      subprocess: {
        resolveExecutable: overrides.resolveExecutable ?? vi.fn().mockResolvedValue('/usr/bin/cloudflared'),
        spawn: overrides.spawn ?? vi.fn().mockReturnValue(handle),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    },
    handle,
  }
}

const BASE_CONFIG: Config = { enabled: true, hostname: 'desktop.example.com', localPort: 3080, cloudflaredPath: 'cloudflared' }

describe('cloudflare-tunnel plugin metadata', () => {
  it('declares the expected name and injections', () => {
    expect(name).toBe('cloudflare-tunnel')
    expect(inject).toContain('subprocess')
    expect(inject).toContain('credentials')
  })

  it('uses a stable credential reference', () => {
    expect(String(TOKEN_CREDENTIAL_REF)).toBe('CLOUDFLARE_TUNNEL_TOKEN')
  })
})

describe('cloudflare-tunnel apply', () => {
  it('spawns cloudflared when enabled', async () => {
    const { ctx, handle } = mockCtx()
    const dispose = await apply(ctx as never, BASE_CONFIG)

    expect(ctx.subprocess.spawn).toHaveBeenCalledOnce()
    const spawnFn = ctx.subprocess.spawn as ReturnType<typeof vi.fn>
    const spec = spawnFn.mock.calls[0]![0] as SubprocessSpawnSpec
    expect(spec.argv).toEqual(['/usr/bin/cloudflared', 'tunnel', 'run', '--token', 'test-tunnel-token'])
    expect(ctx.logger.info).toHaveBeenCalledWith(
      'cloudflare-tunnel: started for %s -> 127.0.0.1:%d',
      'desktop.example.com',
      3080,
    )

    await dispose()
    expect(handle.terminate).toHaveBeenCalledOnce()
    expect(handle.waitForExit).toHaveBeenCalledOnce()
  })

  it('throws with install guidance when cloudflared is not found', async () => {
    const { ctx } = mockCtx({
      resolveExecutable: vi.fn().mockRejectedValue(new Error('not found')),
    })
    await expect(apply(ctx as never, BASE_CONFIG)).rejects.toThrow(/cannot find the cloudflared executable/)
  })

  it('warns and skips spawn when the tunnel token is not configured', async () => {
    const { ctx } = mockCtx({
      credentials: { resolve: vi.fn().mockResolvedValue(undefined) },
    })
    const dispose = await apply(ctx as never, BASE_CONFIG)
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'cloudflare-tunnel: credential "%s" is not configured; tunnel not started',
      String(TOKEN_CREDENTIAL_REF),
    )
    expect(ctx.subprocess.spawn).not.toHaveBeenCalled()
    await dispose()
  })

  it('warns and skips spawn when the hostname is not configured', async () => {
    const { ctx } = mockCtx()
    const dispose = await apply(ctx as never, { ...BASE_CONFIG, hostname: undefined as unknown as string })
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      'cloudflare-tunnel: hostname is not configured; tunnel not started. '
      + 'Set CLOUDFLARE_TUNNEL_HOSTNAME in your .dsh/.env file or in the plugin settings, then restart.',
    )
    expect(ctx.subprocess.spawn).not.toHaveBeenCalled()
    await dispose()
  })

  it('rejects hostnames containing whitespace', async () => {
    const { ctx } = mockCtx()
    await expect(apply(ctx as never, { ...BASE_CONFIG, hostname: 'bad host' }))
      .rejects.toThrow(/must not contain whitespace/)
  })

  it('rejects hostnames that are not valid FQDNs', async () => {
    const { ctx } = mockCtx()
    await expect(apply(ctx as never, { ...BASE_CONFIG, hostname: 'nodot' }))
      .rejects.toThrow(/not a valid fully qualified domain name/)
  })

  it('does nothing when disabled', async () => {
    const { ctx } = mockCtx()
    const dispose = await apply(ctx as never, { ...BASE_CONFIG, enabled: false })
    expect(ctx.subprocess.spawn).not.toHaveBeenCalled()
    expect(ctx.credentials.resolve).not.toHaveBeenCalled()
    await dispose()
  })

  it('dispose is idempotent', async () => {
    const { ctx, handle } = mockCtx()
    const dispose = await apply(ctx as never, BASE_CONFIG)
    await dispose()
    await dispose()
    expect(handle.terminate).toHaveBeenCalledOnce()
  })
})
