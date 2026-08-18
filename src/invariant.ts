/** Package-owned invariant companion. @module @deepseek-ai/dsh-cloudflare-tunnel/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cloudflare-tunnel'

/** Cordis companion plugin name. */
export const name = 'cloudflare-tunnel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the tunnel process lifetime is owned entirely by the
 * plugin fiber's dispose chain; there is no cross-plugin event stream or
 * mutable registry to check. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
