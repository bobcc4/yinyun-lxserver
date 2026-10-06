# 配置指南

V1 可以通过环境变量、外部配置文件、项目根目录 `config.js` 和管理后台进行配置。

## 加载优先级

项目当前定义的优先级由高到低为：

1. WebDAV 恢复或同步的数据。
2. 环境变量。
3. `CONFIG_PATH` 指定的配置文件；未指定时使用 `<DATA_PATH>/config.js`。
4. `src/defaultConfig.ts` 内置默认值。

如果某个值由环境变量固定，管理后台修改后可能在服务重启时再次被环境变量覆盖。生产环境建议把关键网络和密码配置保留在 Docker 环境变量中。

## 网络与路径

| 环境变量 | 配置项 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `PORT` | `port` | `9527` | 服务端口 |
| `BIND_IP` | `bindIP` | `0.0.0.0` | 监听地址 |
| `SERVER_NAME` | `serverName` | `yinyun` | 服务名称 |
| `SUBSONIC_PATH` | `subsonic.path` | `/rest` | Subsonic API 路径 |
| `PROXY_HEADER` | `proxy.header` | `x-real-ip` | 反向代理真实 IP 请求头 |
| `CONFIG_PATH` | - | `<DATA_PATH>/config.js` | 服务端配置文件路径；Docker 建议使用 `/server/data/config.js` |
| `DATA_PATH` | - | `./data` | 服务数据目录 |
| `LOG_PATH` | - | `./logs` | 日志目录 |
| `CACHE_PATH` | - | `./cache` | 播放缓存和封面缓存目录；Windows 服务端可在托盘菜单中设置 |
| `MUSIC_PATH` | - | `./music` | 下载曲库目录；Windows 服务端可在托盘菜单中设置 |

Web 入口从 v1.5.0 起固定：播放器使用 `/`，管理后台使用 `/admin`。不再提供 `ADMIN_PATH` 与 `PLAYER_PATH` 环境变量，旧 `/music` 网页路径返回 404。下载曲库 `/server/music` 是文件系统持久化目录，与网页入口无关。

`CACHE_PATH` 与 `MUSIC_PATH` 只改变文件存储位置，不改变账户隔离结构；系统会继续在目录下使用 `<用户名>` 子目录。Docker 部署时建议直接映射 `/server/cache` 和 `/server/music`，Windows 服务端则使用托盘菜单设置并在重启后生效。

## 账户与访问控制

| 环境变量 | 配置项 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `FRONTEND_PASSWORD` | `frontend.password` | `123456` | 管理后台密码 |
| `LX_USER_<用户名>` | `users` | - | 启动时预置同步账户 |

Windows 客户端、Web 播放器和用户 API 均使用用户名与密码登录，不再提供连接码、根路径识别或用户名路径模式。

## 缓存与歌单

| 环境变量 | 配置项 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `MAX_SNAPSHOT_NUM` | `maxSnapshotNum` | `10` | 最大历史快照数 |
| `ENABLE_LOGIN_USER_CACHE_RESTRICTION` | `user.enableLoginCacheRestriction` | `false` | 限制非管理员修改核心缓存设置 |
| `ENABLE_CACHE_SIZE_LIMIT` | `user.enableCacheSizeLimit` | `false` | 启用缓存容量限制 |
| `CACHE_SIZE_LIMIT` | `user.cacheSizeLimit` | `2000` | 每用户缓存上限，单位 MB |
| `LIST_ADD_MUSIC_LOCATION_TYPE` | `list.addMusicLocationType` | `top` | 新歌曲添加到列表顶部或底部 |

缓存限制只用于可再生成的缓存内容。下载曲库 `/music` 不应被 LRU 自动清理。

## WebDAV

| 环境变量 | 配置项 | 默认值 |
| --- | --- | --- |
| `WEBDAV_ENABLE` | `webdav.enable` | `false` |
| `WEBDAV_URL` | `webdav.url` | 空 |
| `WEBDAV_USERNAME` | `webdav.username` | 空 |
| `WEBDAV_PASSWORD` | `webdav.password` | 空 |
| `WEBDAV_SYNC_PATH` | `webdav.syncPath` | `/lx-sync` |
| `WEBDAV_BACKUP_PATH` | `webdav.backupPath` | `/lx-sync-backups` |
| `SYNC_INTERVAL` | `sync.interval` | `60` 分钟 |
| `BACKUP_INTERVAL` | `sync.backupInterval` | `24` 小时 |

WebDAV 密码建议使用服务商提供的应用专用密码。恢复操作会覆盖本地相关数据，执行前先确认远端备份版本。

## 代理与隐私

| 环境变量 | 配置项 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `PROXY_ALL_ENABLED` | `proxy.all.enabled` | `false` | 服务端外发请求使用代理 |
| `PROXY_ALL_ADDRESS` | `proxy.all.address` | 空 | HTTP 或 SOCKS5 代理地址 |
| `PROXY_MUSIC_MODE` / `PROXY_MUSIC_ADDRESS` | `proxy.music.*` | `inherit` / 空 | 内置音乐平台请求的代理策略和独立地址 |
| `PROXY_CUSTOM_SOURCE_MODE` / `PROXY_CUSTOM_SOURCE_ADDRESS` | `proxy.customSource.*` | `inherit` / 空 | 自定义音源脚本请求的代理策略和独立地址 |
| `PROXY_APP_MODE` / `PROXY_APP_ADDRESS` | `proxy.app.*` | `inherit` / 空 | 应用功能请求的代理策略和独立地址 |
| `ENABLE_DEBUG` | `debug.enabled` | `false` | 自定义音源普通日志开关；错误日志始终保留 |
| `CONFIG_BACKUP_ENABLE` | `configBackup.enable` | `true` | 每日自动备份服务配置 |
| `CONFIG_BACKUP_RETENTION_DAYS` | `configBackup.retentionDays` | `7` | 配置备份保留天数 |
| `CONFIG_BACKUP_DIR` | `configBackup.dir` | `backups` | 配置备份目录；相对路径基于数据目录 |
| `SNAPSHOT_BACKUP_PATH` | `snapshot.backupPath` | 空 | 歌单及不喜欢规则快照目录；相对路径基于数据目录 |
| `DISABLE_TELEMETRY` | `disableTelemetry` | `false` | 禁用匿名统计及相关远程通知 |

分类代理支持 `inherit`（继承全局代理）、`direct`（直连）和 `custom`（使用分类独立地址）。未指定分类配置时保持原全局代理行为；选择直连时不会回退到环境变量代理。

Docker 容器中的 `127.0.0.1` 不等于 NAS 主机。代理位于主机时使用容器可访问的主机地址。

## Subsonic

| 环境变量 | 配置项 | 默认值 |
| --- | --- | --- |
| `SUBSONIC_ENABLE` | `subsonic.enable` | `true` |
| `SUBSONIC_PATH` | `subsonic.path` | `/rest` |

以下高级项当前通过 `config.js` 或后台配置：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `subsonic.enableDebug` | `true` | 记录 Subsonic 调试日志 |
| `subsonic.onlineSearch` | `true` | 开启在线搜索 |
| `subsonic.onlineSearchMode` | `fallback` | `fallback`、`merge` 或 `local_only` |
| `subsonic.onlineSearchSources` | `wy,tx,kw,kg,mg` | 在线搜索平台顺序 |
| `subsonic.lyricTranslation` | `true` | 返回翻译歌词 |

## 业务高级项

| 环境变量或配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `SINGER_SOURCE_PRIORITY` / `singer.sourcePriority` | `tx,wy` | 歌手详情来源优先级 |
| `artist.maxFetchPages` | `20` | 歌手歌曲最大抓取页数 |
| `cache.namingPattern` | `simple` | 下载文件命名规则 |
| `system.allowUnsafeVM` | `false` | 允许不安全原生 VM 音源模式 |

`system.allowUnsafeVM` 只应在确认脚本可信且沙箱模式不兼容时启用。

## Docker 环境变量示例

```yaml
environment:
  NODE_ENV: production
  FRONTEND_PASSWORD: "replace-admin-password"
  SUBSONIC_ENABLE: "true"
  PROXY_ALL_ENABLED: "false"
```

修改环境变量后需要重建容器：

```bash
docker compose up -d --force-recreate
```
