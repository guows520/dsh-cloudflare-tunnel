//#region lib/types/invariant.js
/** Package-owned invariant companion. @module @deepseek-ai/dsh-cloudflare-tunnel/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-cloudflare-tunnel";
/** Cordis companion plugin name. */
const name = "cloudflare-tunnel-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** No runtime invariant: the tunnel process lifetime is owned entirely by the
* plugin fiber's dispose chain; there is no cross-plugin event stream or
* mutable registry to check. */
const install = () => {};
/** Register this package's invariant companion. */
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
