const HOSTS_WITH_LOCAL_CONTROL = new Set(["darwin", "win32", "linux"]);
const HOSTS_WITH_AUTO_LOCAL = new Set(["darwin", "win32"]);
export function shouldMountLocalComputer({ requested, hostPlatform = process.platform, providerSupportsLocal, }) {
    if (!providerSupportsLocal)
        return false;
    if (requested === "local")
        return HOSTS_WITH_LOCAL_CONTROL.has(hostPlatform);
    return requested === undefined && HOSTS_WITH_AUTO_LOCAL.has(hostPlatform);
}
