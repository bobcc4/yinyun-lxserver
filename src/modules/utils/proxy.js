import * as tunnel from 'tunnel'

const httpsRxp = /^https:/

export const PROXY_CATEGORIES = {
    music: { mode: 'proxy.music.mode', address: 'proxy.music.address' },
    customSource: { mode: 'proxy.customSource.mode', address: 'proxy.customSource.address' },
    app: { mode: 'proxy.app.mode', address: 'proxy.app.address' },
}

export function resolveProxyAddress(category) {
    const config = (global.lx && global.lx.config) || {}
    const keys = PROXY_CATEGORIES[category]
    const globalEnabled = !!config['proxy.all.enabled']
    const globalAddress = String(config['proxy.all.address'] || '')
    if (!keys) return globalEnabled ? globalAddress : ''

    const mode = config[keys.mode]
    if (mode === 'direct') return ''
    if (mode === 'custom') return String(config[keys.address] || '')
    return globalEnabled ? globalAddress : ''
}

async function buildAgent(url, address) {
    if (!address) return undefined
    try {
        const proxyUrl = new URL(address)
        if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
            const tunnelOptions = {
                proxy: {
                    host: proxyUrl.hostname,
                    port: proxyUrl.port,
                    proxyAuth: proxyUrl.username ? `${proxyUrl.username}:${proxyUrl.password}` : undefined,
                },
            }
            return (httpsRxp.test(url) ? tunnel.httpsOverHttp : tunnel.httpOverHttp)(tunnelOptions)
        }
        if (proxyUrl.protocol.startsWith('socks')) {
            const { SocksProxyAgent } = await import('socks-proxy-agent')
            return new SocksProxyAgent(address)
        }
    } catch { }
    return undefined
}

export async function getProxyAgent(url, category) {
    const keys = PROXY_CATEGORIES[category]
    if (keys && global.lx?.config?.[keys.mode] === 'direct') return undefined
    const configured = resolveProxyAddress(category)
    if (configured) return buildAgent(url, configured)

    const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy
    if (envProxy) return buildAgent(url, envProxy)
    return undefined
}
