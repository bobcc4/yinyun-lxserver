/**
 * LX Server 通用通知与版本检查引擎
 * 核心特性：
 * 1. 从 bobcc4/yinyun-lxserver 获取版本与系统通知
 * 2. 队列系统：FIFO 队列处理
 * 3. 智能样式：根据 type 和 title 自动匹配图标与配色 (版本火箭、警告三角、广播铃铛)
 */
(function () {
    // ================= 1. 基础配置与资源 =================
    const CONFIG = {
        LATEST_RELEASE_URL: 'https://api.github.com/repos/bobcc4/yinyun-lxserver/releases/latest',
        getLocalVersion: () => (window.CONFIG && window.CONFIG.version) ? window.CONFIG.version : '0.0.0'
    };

    // 图标库 (SVG Path)
    const ICONS = {
        bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
        rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.1 2.73-1.68 4.12-1.98"></path><path d="M15 13v5c0 1.8.71 2.93 2 4 1.15-1.46 1.83-2.6 1.98-4.02.26-2.48.51-3.66 1.02-4.98"></path>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
        check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
        info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
    };

    // 队列状态
    const NOTIFICATION_QUEUE = [];
    let isShowing = false;

    // ================= 2. 工具函数 =================

    function compareVersions(local, remote) {
        if (!local || !remote) return 0;
        const v1 = local.replace(/^v/, '').split('.').map(Number);
        const v2 = remote.replace(/^v/, '').split('.').map(Number);
        const len = Math.max(v1.length, v2.length);
        for (let i = 0; i < len; i++) {
            const n1 = v1[i] || 0;
            const n2 = v2[i] || 0;
            if (n1 < n2) return -1;
            if (n1 > n2) return 1;
        }
        return 0;
    }

    function updateVersionIndicators(latestVersion, releaseUrl) {
        const currentVersion = CONFIG.getLocalVersion().replace(/^v+/, 'v');
        const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;
        const indicators = document.querySelectorAll('#console-version, #sidebar-version');

        indicators.forEach((element) => {
            element.classList.remove('hidden');
            if (hasUpdate) {
                element.textContent = currentVersion + ' · 有新版本 ' + latestVersion;
                element.classList.add('lx-version-update');
                element.title = '发现新版本 ' + latestVersion + '，点击查看发布说明';
                element.setAttribute('role', 'button');
                element.setAttribute('tabindex', '0');
                element.dataset.updateUrl = releaseUrl || '';

                if (element.dataset.updateHandlerBound !== 'true') {
                    const openUpdate = () => {
                        if (window.LxNotification && window.LxNotification.checkUpdates) {
                            window.LxNotification.checkUpdates(true);
                        }
                    };
                    element.addEventListener('click', openUpdate);
                    element.addEventListener('keydown', (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openUpdate();
                        }
                    });
                    element.dataset.updateHandlerBound = 'true';
                }
            } else {
                element.textContent = currentVersion;
                element.classList.remove('lx-version-update');
                element.removeAttribute('role');
                element.removeAttribute('tabindex');
                element.removeAttribute('title');
                delete element.dataset.updateUrl;
            }
        });
    }

    function processQueue() {
        if (isShowing || NOTIFICATION_QUEUE.length === 0) return;

        const { item, storageKey } = NOTIFICATION_QUEUE.shift();
        isShowing = true;
        console.log(`[Notification] Showing from queue: ${item.id}`);

        renderModal(item, storageKey, () => {
            isShowing = false;
            setTimeout(processQueue, 300);
        });
    }

    // 智能获取样式配置
    function getStyleConfig(type, title) {
        const t = title.toLowerCase();

        // 1. 版本更新 (Rocket)
        if (type === 'version' || t.includes('update') || t.includes('更新') || t.includes('版本')) {
            return {
                icon: ICONS.rocket,
                color: 'var(--c-600, #2563eb)', // 主题色
                bg: 'var(--c-50, #eff6ff)',
                label: 'New Update'
            };
        }

        // 2. 警告/维护 (Warning) - 使用醒目的橙色
        if (t.includes('维护') || t.includes('警告') || t.includes('失败') || t.includes('error') || t.includes('warning')) {
            return {
                icon: ICONS.warning,
                color: '#f59e0b', // Amber 500 (固定橙色，起警示作用)
                bg: '#fffbeb',    // Amber 50
                label: 'System Alert'
            };
        }

        // 3. 成功/连接 (Success) - 使用绿色
        if (t.includes('成功') || t.includes('success') || t.includes('完成')) {
            return {
                icon: ICONS.check,
                color: '#10b981', // Emerald 500
                bg: '#ecfdf5',    // Emerald 50
                label: 'Success'
            };
        }

        // 4. 默认/广播 (Bell)
        return {
            icon: ICONS.bell,
            color: 'var(--c-600, #4b5563)', // 默认使用主题色或深灰
            bg: 'var(--c-50, #f3f4f6)',
            label: 'Notification'
        };
    }

    // 渲染 UI (多样式版)
    function renderModal(item, storageKey, onModalClose) {
        if (document.getElementById('ph-notification-overlay')) return;

        const styleConfig = getStyleConfig(item.type, item.ui.title || '');

        // 版本信息展示逻辑
        const currentVer = CONFIG.getLocalVersion();
        const isVerRelated = item.type === 'version' || (item.id && item.id.includes('manual_check'));
        let versionBadge = '';
        if (isVerRelated) {
            let targetVer = '未知';
            const currentVer = CONFIG.getLocalVersion().replace(/^v+/, 'v');
            if (item.logic && item.logic.target_version) {
                targetVer = item.logic.target_version.replace(/^v+/, 'v');
            } else if (item.id === 'manual_check_uptodate') {
                targetVer = currentVer;
            }
            versionBadge = `
                <div style="display: flex; align-items: center; justify-content: space-around; gap: 12px; margin: 16px 0; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; font-size: 13px;">
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <span style="color: rgba(255,255,255,0.4); font-size: 10px; font-weight: 600; text-transform: uppercase;">当前版本</span>
                        <span style="color: #fff; font-weight: 700;">${currentVer}</span>
                    </div>
                    <div style="width: 1px; height: 24px; background: rgba(255,255,255,0.1);"></div>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <span style="color: rgba(255,255,255,0.4); font-size: 10px; font-weight: 600; text-transform: uppercase;">最新版本</span>
                        <span style="color: ${item.type === 'version' ? styleConfig.color : '#fff'}; font-weight: 700; text-shadow: 0 0 10px ${styleConfig.color}40;">${targetVer}</span>
                    </div>
                </div>
            `;
        }

        const overlay = document.createElement('div');
        overlay.id = 'ph-notification-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:99999;display:flex;justify-content:center;align-items:center;font-family:sans-serif;backdrop-filter:blur(4px);transition:opacity 0.3s;';

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: rgba(18, 23, 41, 0.8);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            border: 1px solid rgba(255, 255, 255, 0.12);
            width: 380px; 
            padding: 0;
            border-radius: 28px; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
            text-align: center; 
            overflow: hidden;
            animation: phFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        // 注入全局动画样式
        if (!document.getElementById('ph-style')) {
            const style = document.createElement('style');
            style.id = 'ph-style';
            style.textContent = `
                @keyframes phFadeIn { from {opacity:0;transform:scale(0.95) translateY(20px);} to {opacity:1;transform:scale(1) translateY(0);} }
                .ph-btn { transition: all 0.2s; position: relative; overflow: hidden; }
                .ph-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
                .ph-btn:active { transform: scale(0.98); }
            `;
            document.head.appendChild(style);
        }

        const { title, message, confirm_text, cancel_text } = item.ui;
        const hasCancel = cancel_text && cancel_text.length > 0;

        // 根据样式配置动态生成头部
        modal.innerHTML = `
            <div style="padding: 32px 24px 24px;">
                <div style="
                    margin: 0 auto 16px; 
                    width: 64px; height: 64px; 
                    border-radius: 24px; 
                    background: ${styleConfig.bg}; 
                    color: ${styleConfig.color};
                    display: flex; align-items: center; justify-content: center;
                    border: 1px solid rgba(255,255,255,0.1);
                    box-shadow: 0 8px 24px ${styleConfig.color}30;
                ">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        ${styleConfig.icon}
                    </svg>
                </div>
                
                <h3 style="margin:0 0 10px; color:#fff; font-size:20px; font-weight:700; letter-spacing: -0.5px;">${title}</h3>
                ${versionBadge}
                ${item.ui.date ? `<p style="margin:0 0 8px; color:rgba(255,255,255,0.5); font-size:12px;">发布日期: ${item.ui.date}</p>` : ''}
                
                <div style="margin-top: 16px; padding: 16px; background: rgba(0,0,0,0.2); border-radius: 16px; border: 1px solid rgba(255,255,255,0.05); text-align: left; max-height: 200px; overflow-y: auto;">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${styleConfig.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        <span style="font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.6); text-transform: uppercase;">更新内容与日志</span>
                    </div>
                    <p style="margin:0; color:rgba(255,255,255,0.85); font-size:14px; line-height:1.6;">${message.replace(/\n/g, '<br/>')}</p>
                </div>
            </div>

            <div style="padding: 0 24px 24px; display:flex; gap:12px; justify-content:center;">
                ${hasCancel ? `
                <button id="ph-btn-cancel" class="ph-btn" style="
                    flex:1; padding:14px; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.05); 
                    border-radius:16px; cursor:pointer; color:rgba(255,255,255,0.6); font-weight:600; font-size:15px;
                ">${cancel_text}</button>` : ''}
                
                <button id="ph-btn-confirm" class="ph-btn" style="
                    flex:1; padding:14px; border:none; background:${styleConfig.color}; 
                    color:#ffffff; border-radius:16px; cursor:pointer; font-weight:600; font-size:15px;
                    box-shadow: 0 4px 16px ${styleConfig.color}40; letter-spacing: 0.5px;
                ">${confirm_text}</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const close = () => {
            if (document.body.contains(overlay)) {
                overlay.style.opacity = '0';
                modal.style.transform = 'scale(0.95) translateY(10px)';
                modal.style.opacity = '0';
                modal.style.transition = 'all 0.2s ease-in';
                setTimeout(() => {
                    if (document.body.contains(overlay)) document.body.removeChild(overlay);
                    if (onModalClose) onModalClose();
                }, 200);
            }
        };

        const recordView = () => {
            if (item.logic.interval_hours !== 0) {
                localStorage.setItem(storageKey, Date.now().toString());
            }
        };

        document.getElementById('ph-btn-confirm').onclick = () => {
            recordView();
            const action = item.action ? item.action.type : 'close';

            // 动作处理逻辑
            if (action === 'reload') {
                close();
                if (navigator.serviceWorker) {
                    navigator.serviceWorker.getRegistrations().then(regs => {
                        for (let reg of regs) reg.unregister();
                        window.location.reload(true);
                    });
                } else {
                    window.location.reload(true);
                }
            } else if (action === 'link') {
                close();
                window.open(item.action.url, '_blank');
            } else {
                close();
            }
        };

        if (hasCancel) {
            document.getElementById('ph-btn-cancel').onclick = () => {
                if (item.logic.interval_hours !== 0) {
                    localStorage.setItem(storageKey, Date.now().toString());
                }
                close();
            };
        }
    }

    // ================= 3. 核心逻辑处理 =================
    function processItem(item, isManual = false, force = false) {
        if (!item || item.status !== 'active') return false;

        // Manual check: ONLY allow 'version' type notifications
        if (isManual && item.type !== 'version') return false;

        const currentVer = CONFIG.getLocalVersion();
        const storageKey = `ph_notif_${item.id}`;
        const lastSeen = localStorage.getItem(storageKey);

        // 如果是手动检查，忽略时间间隔限制
        if (!isManual && !force && lastSeen) {
            const interval = item.logic.interval_hours;
            if (interval === -1) return false;
            const hoursPassed = (Date.now() - parseInt(lastSeen)) / (1000 * 60 * 60);
            if (hoursPassed < interval) return false;
        }

        if (item.type === 'version') {
            const target = item.logic.target_version;
            // 如果是手动检查，且已经是最新版，返回 false
            if (item.logic.operator === '<' && compareVersions(currentVer, target) >= 0) {
                return false;
            }
        }

        NOTIFICATION_QUEUE.push({ item, storageKey });
        processQueue();
        return true;
    }

    // ================= 4. GitHub Release 检查 =================
    const RELEASE_CACHE_KEY = 'yinyun_release_check_v1';
    const RELEASE_CACHE_TTL = 6 * 60 * 60 * 1000;
    let releaseCheckState = readReleaseCheckState();
    let releaseRequest = null;

    function validRelease(release) {
        return release && typeof release.tag_name === 'string' && /^v?\d+\.\d+\.\d+$/.test(release.tag_name);
    }

    function readReleaseCheckState() {
        try {
            const state = JSON.parse(localStorage.getItem(RELEASE_CACHE_KEY));
            if (state && typeof state === 'object') return state;
        } catch (_) { /* Storage may be unavailable in private browsing. */ }
        return {};
    }

    function saveReleaseCheckState() {
        try { localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(releaseCheckState)); } catch (_) {}
    }

    function releaseCheckError(failure) {
        const error = new Error(failure.message);
        error.status = failure.status;
        error.rateLimited = failure.rateLimited;
        error.retryAt = failure.retryAt;
        return error;
    }

    async function loadLatestRelease(refresh) {
        // Respect GitHub's cooldown even for manual checks and across page reloads.
        const failure = releaseCheckState.failure;
        if (failure && failure.retryAt > Date.now()) throw releaseCheckError(failure);
        if (!refresh && validRelease(releaseCheckState.release) &&
            releaseCheckState.checkedAt <= Date.now() &&
            Date.now() - releaseCheckState.checkedAt < RELEASE_CACHE_TTL) return releaseCheckState.release;
        if (releaseRequest) return releaseRequest;
        releaseRequest = (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const res = await fetch(CONFIG.LATEST_RELEASE_URL, {
                    cache: 'no-store', signal: controller.signal,
                    headers: { Accept: 'application/vnd.github+json' }
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    const rateLimited = res.status === 429 || (res.status === 403 &&
                        (res.headers.get('x-ratelimit-remaining') === '0' ||
                            /rate limit|abuse detection/i.test(body.message || '')));
                    const retryAfter = res.headers.get('retry-after');
                    const retryAt = retryAfter
                        ? (/^\d+$/.test(retryAfter) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter))
                        : Number(res.headers.get('x-ratelimit-reset')) * 1000;
                    const error = new Error(`GitHub Release HTTP ${res.status}`);
                    error.status = res.status;
                    error.rateLimited = rateLimited;
                    error.retryAt = rateLimited
                        ? Math.max(Date.now() + 60000, Number.isFinite(retryAt) && retryAt > Date.now()
                            ? retryAt + 1000 : Date.now() + 60 * 60 * 1000)
                        : Date.now() + 15 * 60 * 1000;
                    throw error;
                }
                const release = await res.json();
                if (!validRelease(release)) throw new Error('GitHub Release did not return a valid version');
                // Keep only public version metadata, not the entire GitHub response.
                const metadata = {
                    tag_name: release.tag_name,
                    html_url: `https://github.com/bobcc4/yinyun-lxserver/releases/tag/${release.tag_name}`,
                    published_at: release.published_at
                };
                releaseCheckState = { release: metadata, checkedAt: Date.now() };
                saveReleaseCheckState();
                return metadata;
            } catch (error) {
                releaseCheckState.failure = {
                    message: error.message, status: error.status, rateLimited: !!error.rateLimited,
                    retryAt: error.retryAt || Date.now() + 15 * 60 * 1000
                };
                saveReleaseCheckState();
                console.warn('[Notification] 更新检查暂不可用，将在等待后重试：', error.message);
                throw releaseCheckError(releaseCheckState.failure);
            } finally {
                clearTimeout(timeout);
            }
        })();
        try { return await releaseRequest; } finally { releaseRequest = null; }
    }

    async function fetchLatestRelease(isManual = false, force = false) {
        if (validRelease(releaseCheckState.release)) {
            updateVersionIndicators(releaseCheckState.release.tag_name, releaseCheckState.release.html_url);
        }
        try {
            const release = await loadLatestRelease(isManual || force);
            const latestVersion = release.tag_name;

            updateVersionIndicators(latestVersion, release.html_url);

            const publishedDate = release.published_at
                ? new Date(release.published_at).toLocaleDateString('zh-CN')
                : '';
            const releaseItem = {
                id: `github_release_${latestVersion}`,
                status: 'active',
                type: 'version',
                logic: {
                    target_version: latestVersion,
                    operator: '<',
                    interval_hours: -1
                },
                ui: {
                    title: `发现新版本 ${latestVersion}`,
                    message: publishedDate
                        ? `GitHub Release 已于 ${publishedDate} 发布，点击下方按钮查看更新说明和安装包。`
                        : 'GitHub Release 已发布，点击下方按钮查看更新说明和安装包。',
                    confirm_text: '查看发布页',
                    cancel_text: '关闭'
                },
                action: {
                    type: 'link',
                    url: release.html_url || 'https://github.com/bobcc4/yinyun-lxserver/releases/latest'
                }
            };
            const hasUpdate = processItem(releaseItem, isManual, force);

            if (isManual && !hasUpdate) {
                const upToDateItem = {
                    id: 'manual_check_uptodate',
                    type: 'info',
                    ui: {
                        title: '当前已是最新版本',
                        message: `GitHub Release 最新版本为 ${latestVersion}，当前版本为 ${CONFIG.getLocalVersion()}。`,
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0, target_version: latestVersion }
                };
                renderModal(upToDateItem, 'temp_manual_check', null);
            }
        } catch (e) {
            if (isManual) {
                let errorTitle = '检查更新失败';
                let errorMessage = '无法连接到更新服务器，请检查网络连接或稍后重试。';

                if (e.status === 404) {
                    errorMessage = 'GitHub 暂未发布正式版本，请稍后重试。';
                } else if (e.rateLimited) {
                    errorMessage = '当前网络出口的 GitHub 更新接口额度已用完，暂时无法确认最新版本。这不影响音乐播放，也不代表 NAS 登录失败。';
                } else if (e.status === 403) {
                    errorMessage = 'GitHub 拒绝了更新检查请求（403），请检查网络或代理设置。这不代表 NAS 登录失败。';
                }
                if (e.retryAt) errorMessage += ` 请在 ${new Date(e.retryAt).toLocaleString('zh-CN')} 后重试，或直接查看发布页。`;

                const errorItem = {
                    id: 'manual_check_error',
                    type: 'warning',
                    ui: {
                        title: errorTitle,
                        message: errorMessage,
                        confirm_text: '查看发布页',
                        cancel_text: '关闭'
                    },
                    action: { type: 'link', url: 'https://github.com/bobcc4/yinyun-lxserver/releases/latest' },
                    logic: { interval_hours: 0 }
                };
                renderModal(errorItem, 'temp_manual_error', null);
            }
        }
    }

    // ================= 5. 初始化入口 =================
    function init() {
        // 进入页面恢复版本标记，缓存过期后检查；同一版本只自动弹窗一次。
        checkUpdates(false, false);
    }

    async function checkUpdates(isManual = false, force = false) {
        if (window.CONFIG && window.CONFIG.disableTelemetry) {
            if (isManual) {
                const disabledItem = {
                    id: 'manual_check_disabled',
                    type: 'warning',
                    ui: {
                        title: '检查更新已禁用',
                        message: '当前配置已禁用匿名统计与在线更新检查，请前往 bobcc4/yinyun-lxserver 的 GitHub 发布页面查看最新版本。',
                        confirm_text: '确定',
                        cancel_text: ''
                    },
                    action: { type: 'close' },
                    logic: { interval_hours: 0 }
                };
                renderModal(disabledItem, 'temp_manual_disabled', null);
            }
            return;
        }
        await fetchLatestRelease(isManual, force);
    }

    // 暴露给全局的方法
    window.LxNotification = {
        checkUpdates: checkUpdates
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
