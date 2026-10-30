/**
 * Host half of the `dsh-user-code-block` plugin.
 *
 * There is no server logic: the plugin is purely client-side. The empty `apply`
 * exists so the row appears in the profile's cordis tree — the browser half is
 * discovered through `package.json` (`exports["./client"]` and the `dsh.client`
 * declaration).
 */
export function apply() {}
