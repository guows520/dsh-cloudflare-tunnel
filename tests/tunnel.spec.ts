/**
 * Unit tests for the cloudflare-tunnel function plugin. The subprocess and
 * credentials services are mocked because cloudflared is not available in CI.
 */

import { describe, expect, it, vi } from 'vitest'
import { apply, Config, name, inject, TOKEN_CREDENTIAL_REF } from '../src/index.ts'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import * as installer from '../src/installer.ts'
import { CLOUDFLARED_SHA256, CLOUDFLARED_VERSION, managedCloudflaredPath } from '../src/installer.ts'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** SHA-256 of the three-byte string "abc", for download verification tests. */
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

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

const BASE_CONFIG: Config = { enabled: true, hostname: 'desktop.example.com', localPort: 3080, cloudflaredPath: 'cloudflared', autoInstall: true }

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
      await expect(apply(ctx as never, { ...BASE_CONFIG, autoInstall: false })).rejects.toThrow(/cannot find the cloudflared executable/)
    })

    it('auto-installs the pinned cloudflared when it is not on PATH', async () => {
      const managed = managedCloudflaredPath()
      const ensure = vi.spyOn(installer, 'ensureManagedCloudflared').mockResolvedValue(managed)
      try {
        const { ctx, handle } = mockCtx({
          resolveExecutable: vi.fn().mockRejectedValue(new Error('not found')),
        })
        const dispose = await apply(ctx as never, BASE_CONFIG)
        expect(ensure).toHaveBeenCalledOnce()
        const spec = (ctx.subprocess.spawn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as SubprocessSpawnSpec
        expect(spec.argv[0]).toBe(managed)
        expect(ctx.logger.info).toHaveBeenCalledWith(
          'cloudflare-tunnel: cloudflared not found on PATH; installing %s to %s',
          CLOUDFLARED_VERSION,
          managed,
        )
        await dispose()
        expect(handle.terminate).toHaveBeenCalledOnce()
      } finally {
        ensure.mockRestore()
      }
    })

    it('does not auto-install when autoInstall is disabled', async () => {
      const ensure = vi.spyOn(installer, 'ensureManagedCloudflared')
      try {
        const { ctx } = mockCtx({
          resolveExecutable: vi.fn().mockRejectedValue(new Error('not found')),
        })
        await expect(apply(ctx as never, { ...BASE_CONFIG, autoInstall: false }))
          .rejects.toThrow(/cannot find the cloudflared executable/)
        expect(ensure).not.toHaveBeenCalled()
      } finally {
        ensure.mockRestore()
      }
    })

    it('surfaces automatic installation failures with manual guidance', async () => {
      const ensure = vi.spyOn(installer, 'ensureManagedCloudflared')
        .mockRejectedValue(new Error('checksum mismatch for https://example.invalid'))
      try {
        const { ctx } = mockCtx({
          resolveExecutable: vi.fn().mockRejectedValue(new Error('not found')),
        })
        await expect(apply(ctx as never, BASE_CONFIG))
          .rejects.toThrow(/automatic cloudflared installation/)
      } finally {
        ensure.mockRestore()
      }
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
      + 'Set CLOUDFLARE_TUNNEL_HOSTNAME in your .dsh/.env file, then restart.',
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

describe('cloudflared installer', () => {
  it('pins a release version and a 64-hex checksum', () => {
    expect(CLOUDFLARED_VERSION).toMatch(/^\d{4}\.\d+\.\d+$/)
    expect(CLOUDFLARED_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('resolves the managed path under DSH_HOME', () => {
    const binary = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
    expect(managedCloudflaredPath({ DSH_HOME: '/tmp/dsh-home' } as NodeJS.ProcessEnv))
      .toBe(join('/tmp/dsh-home', 'bin', binary))
  })

  it('streams the sha256 of known content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-'))
    try {
      const file = join(dir, 'sample.bin')
      await writeFile(file, 'abc')
      await expect(installer.sha256File(file)).resolves.toBe(ABC_SHA256)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('downloads atomically and enforces the checksum', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-'))
    const target = join(dir, 'cloudflared.exe')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('abc'))
          controller.close()
        },
      }),
    }) as Response)
    try {
      await installer.downloadAndVerify('https://example.invalid/x', target, ABC_SHA256)
      await expect(readFile(target, 'utf8')).resolves.toBe('abc')
      const bad = join(dir, 'bad.exe')
      await expect(installer.downloadAndVerify('https://example.invalid/x', bad, '0'.repeat(64)))
        .rejects.toThrow(/checksum mismatch/)
      await expect(readFile(bad, 'utf8')).rejects.toThrow()
    } finally {
      fetchMock.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
