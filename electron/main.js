'use strict'

const { app, Tray, Menu, shell, nativeImage, BrowserWindow, dialog } = require('electron')
const path = require('path')
const net = require('net')
const fs = require('fs')

// ─── 单实例锁：防止打开多个后台 ──────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
    app.quit()
} else {
    // 第二个实例启动时，聚焦已有窗口
    app.on('second-instance', () => {
        if (playerWindow && !playerWindow.isDestroyed()) {
            if (playerWindow.isMinimized()) playerWindow.restore()
            playerWindow.show()
            playerWindow.focus()
        }
    })
}

// ─── 配置加载逻辑 ─────────────────────────────────────────────────────────
const defaultStorageRoot = app.getPath('userData')
const basePathConfigFile = path.join(defaultStorageRoot, 'base_path.json')

// Preserve the storage selection made by desktop releases published before the Yinyun rename.
if (!fs.existsSync(basePathConfigFile)) {
    const appDataRoot = app.getPath('appData')
    const legacyConfigFiles = ['Yintuan', 'LX Music Server', 'LX Music Sync Server', 'lx-music-sync-server']
        .map(name => path.join(appDataRoot, name, 'base_path.json'))
    const legacyConfigFile = legacyConfigFiles.find(file => fs.existsSync(file))
    if (legacyConfigFile) {
        try {
            fs.mkdirSync(defaultStorageRoot, { recursive: true })
            fs.copyFileSync(legacyConfigFile, basePathConfigFile)
        } catch (error) {
            console.error('Migrate legacy desktop config failed:', error)
        }
    }
}

function getAppConfig() {
    try {
        if (fs.existsSync(basePathConfigFile)) {
            const content = fs.readFileSync(basePathConfigFile, 'utf8')
            return content ? JSON.parse(content) : {}
        }
    } catch (_) { }
    return {}
}

function updateAppConfig(newConfig) {
    try {
        const config = getAppConfig()
        const merged = { ...config, ...newConfig }
        if (!fs.existsSync(defaultStorageRoot)) fs.mkdirSync(defaultStorageRoot, { recursive: true })
        fs.writeFileSync(basePathConfigFile, JSON.stringify(merged))
    } catch (e) { console.error('Save config failed:', e) }
}

function getStoredPath() {
    const data = getAppConfig()
    if (data.storagePath && fs.existsSync(data.storagePath)) {
        return data.storagePath
    }
    return null
}

function saveStoredPath(newPath) {
    updateAppConfig({ storagePath: newPath })
}

function getConfiguredDirectory(configKey, fallback) {
    const value = getAppConfig()[configKey]
    return value ? path.resolve(value) : fallback
}

function getCachePath() {
    return getConfiguredDirectory('cachePath', path.join(process.cwd(), 'cache'))
}

function getMusicPath() {
    return getConfiguredDirectory('musicPath', path.join(process.cwd(), 'music'))
}

function configureServerDirectories() {
    process.env.CACHE_PATH = getCachePath()
    process.env.MUSIC_PATH = getMusicPath()
}

function isPathInside(parent, candidate) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function moveDirectoryContents(source, target) {
    if (!fs.existsSync(source)) return
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name)
        const targetPath = path.join(target, entry.name)
        fs.cpSync(sourcePath, targetPath, { recursive: true, force: true })
    }
    fs.rmSync(source, { recursive: true, force: true })
}

function changeServerDirectory(configKey, label, currentPath, otherPath) {
    const result = dialog.showOpenDialogSync({
        title: `选择${label}`,
        defaultPath: currentPath,
        properties: ['openDirectory', 'createDirectory'],
    })
    if (!result || !result[0]) return

    const newPath = path.resolve(result[0])
    if (newPath === path.resolve(currentPath)) return
    if (newPath === path.resolve(otherPath) || isPathInside(currentPath, newPath) || isPathInside(newPath, currentPath)) {
        dialog.showMessageBoxSync({
            type: 'warning',
            title: `${label}不可用`,
            message: `${label}不能与其他目录相同，也不能互相嵌套。`,
            buttons: ['确定'],
        })
        return
    }

    const choice = dialog.showMessageBoxSync({
        type: 'question',
        title: `更改${label}`,
        message: `是否将当前目录中的已有文件迁移到新目录？`,
        detail: `当前：${currentPath}\n新目录：${newPath}`,
        buttons: ['迁移已有文件', '仅切换目录', '取消'],
        defaultId: 0,
        cancelId: 2,
    })
    if (choice === 2) return

    try {
        if (choice === 0) moveDirectoryContents(currentPath, newPath)
        updateAppConfig({ [configKey]: newPath })
        dialog.showMessageBoxSync({
            type: 'info',
            title: `${label}已更新`,
            message: `${label}将在重启服务端后生效。`,
            buttons: ['立即重启'],
        })
        app.relaunch()
        app.exit()
    } catch (error) {
        dialog.showMessageBoxSync({
            type: 'error',
            title: `${label}迁移失败`,
            message: error?.message || String(error),
            buttons: ['确定'],
        })
    }
}

if (getAppConfig().disableAcceleration) {
    app.disableHardwareAcceleration()
}

// ─── 核心状态 ──────────────────────────────────────────────────────────────
let storageRoot = null
let SERVER_PORT = 9527
let BASE_URL = ''
let tray = null
let playerWindow = null  // 播放器窗口（常驻，关闭只隐藏）
let adminWindow = null   // 管理后台窗口（可正常关闭）

// 获取当前路径工具函数
const getPlayerPath = () => '/'
const getAdminPath = () => {
    try {
        const configPath = storageRoot && path.join(storageRoot, 'config.js')
        if (configPath && fs.existsSync(configPath)) {
            delete require.cache[require.resolve(configPath)]
            const config = require(configPath)
            const value = String(config['admin.path'] || '').trim().replace(/\/+$/, '')
            if (value.startsWith('/')) return value
        }
    } catch (error) {
        console.error('Read admin path failed:', error)
    }
    return '/admin'
}

const appRoot = app.getAppPath()
const staticPath = app.isPackaged
    ? path.join(appRoot + '.unpacked', 'public')
    : path.join(appRoot, 'public')
process.env.STATIC_PATH = staticPath

if (app.isPackaged) {
    process.chdir(path.dirname(app.getPath('exe')))
}

// ─── 服务器启动 ─────────────────────────────────────────────────────────────
async function startServer() {
    const dataDir = path.join(storageRoot, 'data')
    const logsDir = path.join(storageRoot, 'logs')
    process.env.DATA_PATH = dataDir
    process.env.LOG_PATH = logsDir
    process.env.CONFIG_PATH = path.join(storageRoot, 'config.js')
    configureServerDirectories()

        ;[dataDir, logsDir, getCachePath(), getMusicPath()].forEach(d => { try { fs.mkdirSync(d, { recursive: true }) } catch (_) { } })

    const getAvailablePort = (startPort) => {
        return new Promise((resolve) => {
            const server = net.createServer()
            server.listen(startPort, '0.0.0.0', () => {
                const { port } = server.address()
                server.close(() => resolve(port))
            })
            server.on('error', () => resolve(getAvailablePort(startPort + 1)))
        })
    }

    SERVER_PORT = await getAvailablePort(9527)
    process.env.PORT = SERVER_PORT.toString()
    process.env.BIND_IP = '0.0.0.0'
    BASE_URL = `http://127.0.0.1:${SERVER_PORT}`

    try {
        require('../index.js')
        await waitForServer(SERVER_PORT)
    } catch (err) {
        console.error('Server Failed:', err)
        throw err
    }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────
async function waitForServer(port, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        const ready = await new Promise((resolve) => {
            let settled = false
            const socket = net.createConnection({ host: '127.0.0.1', port })
            const finish = (result) => {
                if (settled) return
                settled = true
                socket.destroy()
                resolve(result)
            }

            socket.setTimeout(1000)
            socket.once('connect', () => finish(true))
            socket.once('timeout', () => finish(false))
            socket.once('error', () => finish(false))
        })

        if (ready) return
        await new Promise(resolve => setTimeout(resolve, 250))
    }

    throw new Error(`Server did not start within ${Math.round(timeoutMs / 1000)} seconds (port ${port})`)
}

function getIcon(name) {
    const p = path.join(appRoot, 'electron', 'icons', name)
    if (fs.existsSync(p)) return nativeImage.createFromPath(p)
    return null
}

function loadWindowURL(window, url, label) {
    let retryCount = 0
    let retryTimer = null
    const maxRetries = 5

    const load = () => {
        if (window.isDestroyed()) return
        void window.loadURL(url).catch(() => { })
    }

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || window.isDestroyed()) return
        console.error(`${label} load failed:`, { errorCode, errorDescription, validatedURL })

        if (retryCount < maxRetries) {
            retryCount += 1
            clearTimeout(retryTimer)
            retryTimer = setTimeout(load, 1000)
            return
        }

        void dialog.showMessageBox(window, {
            type: 'error',
            title: `${label} load failed`,
            message: `Unable to load ${url}`,
            detail: `${errorDescription} (${errorCode})`,
            buttons: ['Retry', 'Close'],
            defaultId: 0,
            cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) {
                retryCount = 0
                load()
            } else if (!window.isDestroyed()) {
                window.destroy()
            }
        })
    })

    window.webContents.on('did-navigate', () => {
        retryCount = 0
        clearTimeout(retryTimer)
    })
    window.on('closed', () => clearTimeout(retryTimer))
    load()
}

function handleRendererFailure(window, label) {
    window.webContents.on('render-process-gone', (_event, details) => {
        if (app.isQuiting || details.reason === 'clean-exit') return
        console.error(`${label} renderer stopped:`, details)

        const response = dialog.showMessageBoxSync({
            type: 'error',
            title: `${label} rendering failed`,
            message: 'The interface renderer stopped unexpectedly.',
            detail: `Reason: ${details.reason}. You can restart with hardware acceleration disabled.`,
            buttons: ['Disable acceleration and restart', 'Exit'],
            defaultId: 0,
            cancelId: 1,
        })

        if (response === 0) {
            updateAppConfig({ disableAcceleration: true })
            app.relaunch()
        }
        app.exit()
    })
}



// ─── 播放器窗口管理（常驻，关闭只隐藏，保持音乐播放） ──────────────────────────
function showPlayerWindow() {
    const playerURL = `${BASE_URL}${getPlayerPath()}`

    if (!playerWindow || playerWindow.isDestroyed()) {
        playerWindow = new BrowserWindow({
            title: '音云 Yinyun',
            width: 1200,
            height: 850,
            minWidth: 900,
            minHeight: 650,
            icon: getIcon('icon.png'),
            autoHideMenuBar: true,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                // 禁用 CORS/混合内容安全检查，允许渲染进程连接局域网音云服务。
                webSecurity: false,
            }
        })
        playerWindow.once('ready-to-show', () => playerWindow.show())
        playerWindow.on('page-title-updated', (e) => e.preventDefault())
        handleRendererFailure(playerWindow, 'Yinyun Player')
        // 关闭时只隐藏，保持后台播放
        playerWindow.on('close', (event) => {
            if (!app.isQuiting) {
                event.preventDefault()
                playerWindow.hide()
            }
        })
        loadWindowURL(playerWindow, playerURL, 'Yinyun Player')
    } else {
        // 窗口已存在：若已显示且在播放器页，直接聚焦；否则 show+focus
        playerWindow.show()
        playerWindow.focus()
    }
}

// ─── 管理后台窗口管理（独立窗口，不影响播放器） ────────────────────────────────
function showAdminWindow() {
    const adminPath = getAdminPath()
    const adminURL = adminPath ? `${BASE_URL}${adminPath}` : BASE_URL

    if (!adminWindow || adminWindow.isDestroyed()) {
        adminWindow = new BrowserWindow({
            title: '音云 Yinyun - 管理后台',
            width: 1200,
            height: 850,
            minWidth: 900,
            minHeight: 650,
            icon: getIcon('icon.png'),
            autoHideMenuBar: true,
            show: false,
            webPreferences: { nodeIntegration: false, contextIsolation: true }
        })
        adminWindow.once('ready-to-show', () => adminWindow.show())
        adminWindow.on('page-title-updated', (e) => e.preventDefault())
        handleRendererFailure(adminWindow, 'Yinyun Admin')
        // 管理后台直接关闭即可（不需要保持后台）
        adminWindow.on('closed', () => {
            adminWindow = null
        })
        loadWindowURL(adminWindow, adminURL, 'Yinyun Admin')
    } else {
        adminWindow.show()
        adminWindow.focus()
    }
}

// ─── 托盘创建 ──────────────────────────────────────────────────────────────
function createTray() {
    const icon = getIcon('tray.png') || nativeImage.createEmpty()
    tray = new Tray(icon)
    tray.setToolTip(`音云 Yinyun (${SERVER_PORT})`)

    const menu = Menu.buildFromTemplate([
        { label: `● 运行中 (端口: ${SERVER_PORT})`, enabled: false },
        { label: `● 存储目录 : ${path.basename(storageRoot)}`, enabled: false },
        { type: 'separator' },
        { label: '打开播放器', click: () => showPlayerWindow() },
        { label: '打开管理后台', click: () => showAdminWindow() },
        { type: 'separator' },
        {
            label: '设置与管理',
            submenu: [
                {
                    label: '开机自动运行',
                    type: 'checkbox',
                    checked: app.getLoginItemSettings().openAtLogin,
                    click: (item) => {
                        app.setLoginItemSettings({ openAtLogin: item.checked })
                    }
                },
                {
                    label: '启动时不显示主界面 (最小化到托盘)',
                    type: 'checkbox',
                    checked: !!getAppConfig().silentStart,
                    click: (item) => {
                        updateAppConfig({ silentStart: item.checked })
                    }
                },
                {
                    label: '关闭硬件加速 (需重启生效)',
                    type: 'checkbox',
                    checked: !!getAppConfig().disableAcceleration,
                    click: (item) => {
                        updateAppConfig({ disableAcceleration: item.checked })
                        dialog.showMessageBox({ type: 'info', title: '提示', message: '更改硬件加速设置需要重启软件才能生效。' })
                    }
                },
                { type: 'separator' },
                {
                    label: '更换存储位置...',
                    click: () => {
                        const result = dialog.showOpenDialogSync({
                            title: '选择数据和日志存放目录',
                            properties: ['openDirectory', 'createDirectory']
                        })
                        if (result && result[0]) {
                            const newPath = result[0]
                            if (newPath === storageRoot) return

                            // 询问用户是否迁移
                            const choice = dialog.showMessageBoxSync({
                                type: 'question',
                                title: '是否迁移数据?',
                                message: '您改变了存储位置，是否需要将原有的数据(包含您的配置、用户的收藏列表)一起迁移到新目录下？\n\n【说明】：迁移后将自动删除旧目录中的数据文件。',
                                buttons: ['迁移原有数据', '仅使用新目录 (当做新空服务端)', '取消']
                            })

                            if (choice === 2) return // 取消

                            if (choice === 0) { // 迁移
                                try {
                                    const itemsToMove = ['data', 'logs', 'config.js']
                                    itemsToMove.forEach(item => {
                                        const src = path.join(storageRoot, item)
                                        const dest = path.join(newPath, item)
                                        if (fs.existsSync(src)) {
                                            fs.cpSync(src, dest, { recursive: true })
                                            // 复制成功后删除旧文件
                                            fs.rmSync(src, { recursive: true, force: true })
                                        }
                                    })
                                } catch (err) {
                                    dialog.showMessageBoxSync({
                                        type: 'error',
                                        title: '迁移遇到问题',
                                        message: `迁移时部分文件被系统占用导致无法被移动或删除，请后续手动去旧目录检查拷贝或删除残余文件。\n\n具体错误: ${err.message}`
                                    })
                                }
                            }

                            saveStoredPath(newPath)
                            if (process.env.PORTABLE_EXECUTABLE_FILE) {
                                app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE })
                            } else {
                                app.relaunch()
                            }
                            app.exit()
                        }
                    }
                },
                {
                    label: '更换缓存目录...',
                    click: () => changeServerDirectory('cachePath', '缓存目录', getCachePath(), getMusicPath()),
                },
                {
                    label: '更换下载目录...',
                    click: () => changeServerDirectory('musicPath', '下载目录', getMusicPath(), getCachePath()),
                },
                { type: 'separator' },
                { label: '打开当前存储路径', click: () => shell.openPath(storageRoot) },
                { label: '用外部浏览器打开', click: () => shell.openExternal(BASE_URL) }
            ]
        },
        { type: 'separator' },
        {
            label: '重启软件', click: () => {
                if (process.env.PORTABLE_EXECUTABLE_FILE) {
                    app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE })
                } else {
                    app.relaunch()
                }
                app.exit()
            }
        },
        { label: '完全退出', click: () => { app.isQuiting = true; app.quit() } },
    ])
    tray.setContextMenu(menu)
    // 点击托盘图标：若播放器已在前台则最小化，否则显示
    tray.on('click', () => {
        if (playerWindow && !playerWindow.isDestroyed() && playerWindow.isVisible() && playerWindow.isFocused()) {
            playerWindow.hide()
        } else {
            showPlayerWindow()
        }
    })
}

// ─── App 生命周期 ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
    storageRoot = getStoredPath()

    // 初始化引导
    if (!storageRoot) {
        const choice = dialog.showMessageBoxSync({
            type: 'question',
            title: '初始化存储位置',
            message: '请先选择一个用于存放数据和日志的文件夹。',
            buttons: ['选择文件夹', '使用默认 (AppData)']
        })
        storageRoot = (choice === 0) ? (dialog.showOpenDialogSync({ properties: ['openDirectory', 'createDirectory'] }) || [defaultStorageRoot])[0] : defaultStorageRoot
        saveStoredPath(storageRoot)
    }

    try {
        await startServer()
    } catch (err) {
        dialog.showErrorBox(
            'Yinyun startup failed',
            `${err && err.message ? err.message : err}\n\nStorage path: ${storageRoot}`,
        )
        app.quit()
        return
    }
    if (process.platform === 'darwin' && app.dock) app.dock.hide()
    createTray()

    // 启动时根据配置决定是否显示主界面
    if (!getAppConfig().silentStart) {
        showPlayerWindow()
    }
})

// 托盘 App 重写退出逻辑
app.on('before-quit', () => { app.isQuiting = true })
app.on('window-all-closed', () => { })
