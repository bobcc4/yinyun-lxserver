# Yinyun

<p align="center"><img src="public/icon.svg" width="120" height="120" alt="Yinyun"></p>

<div align="center">
  <p>
    <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status">
    <img src="https://img.shields.io/badge/version-v1.6.5-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/node-%3E%3D22.12-green?style=flat-square" alt="Node Version">
    <img src="https://img.shields.io/github/license/bobcc4/yinyun-lxserver?style=flat-square" alt="License">
    <br>
    <br>
    <a href="https://github.com/bobcc4/yinyun-lxserver/stargazers"><img src="https://img.shields.io/github/stars/bobcc4/yinyun-lxserver?style=flat-square&color=ffe16b" alt="GitHub stars"></a>
    <a href="https://github.com/bobcc4/yinyun-lxserver/network/members"><img src="https://img.shields.io/github/forks/bobcc4/yinyun-lxserver?style=flat-square" alt="GitHub forks"></a>
    <a href="https://github.com/bobcc4/yinyun-lxserver/issues"><img src="https://img.shields.io/github/issues/bobcc4/yinyun-lxserver?style=flat-square&color=red" alt="GitHub issues"></a>
    <a href="https://github.com/bobcc4/yinyun-lxserver/commits/main"><img src="https://img.shields.io/github/last-commit/bobcc4/yinyun-lxserver?style=flat-square&color=blueviolet" alt="Last Commit"></a>
    <img src="https://img.shields.io/github/commit-activity/m/bobcc4/yinyun-lxserver?style=flat-square&color=ff69b4" alt="Commit Activity">
    <a href="https://github.com/bobcc4/yinyun-lxserver/releases"><img src="https://img.shields.io/github/downloads/bobcc4/yinyun-lxserver/total?style=flat-square&color=blue" alt="Total Downloads"></a>
  </p>
</div>

[Documentation](https://bobcc4.github.io/yinyun-lxserver/) | [SyncServer](md/lxserver_EN.md) | [Changelog](changelog.md) | [中文版](README.md)

---
**Yinyun** is a self-hosted music server with a Web player, downloads, local-library management, encrypted Windows account snapshots, and Subsonic client support.

Yinyun servers can share playlists with one another through expiring links or JSON files. The recipient previews local and online matches before importing a normal playlist; local files are reused when available. The exchange does not include audio files, credentials, tokens, proxies, or temporary URLs, and it does not provide LX Music client import compatibility.

> [!IMPORTANT]
> v1.5.0 uses fixed entry points: `/` for the Web player and `/admin` for the management console. The former `/music` Web route has been removed. `/api/v1`, Subsonic `/rest`, and the `/server/music` persistent audio directory are unchanged.

## ✨ Web Player Key Features

### 1. Multi-platform Search and Playback

Search across major music platforms from one interface. Results can be played, favorited, or downloaded directly, with quick source and content-type filters.

<p align="center">
  <img src="docs/public/screenshots/web-search.png" width="900" alt="Web player online search">
</p>

### 2. Local Library Management

Scan `/music` and `/cache`, including nested directories. Use quick search, advanced Boolean filters, batch selection, playlist collection, and metadata management.

<p align="center">
  <img src="docs/public/screenshots/web-local-music.png" width="900" alt="Local music library">
</p>

### 3. Eight Quality Levels and Server Downloads

Choose from standard, high, lossless, 24-bit lossless, Hi-Res, Atmos, enhanced Atmos, and master quality. The download dialog shows the resolved file size and source platform, while server-side queues continue after the browser closes.

<p align="center">
  <img src="docs/public/screenshots/web-download-quality.png" width="900" alt="Download quality, file size, and source platform">
</p>

### 4. Local Track Remastering

Filter and batch-select local tracks for replacement at a chosen target quality. When the target is unavailable, configurable fallback is supported and the result lists successful and failed tracks.

<p align="center">
  <img src="docs/public/screenshots/web-remaster.png" width="900" alt="Track remaster selection">
</p>

### 5. Player Settings and Custom Sources

Configure default quality, caching, downloads, proxies, lyrics, themes, audio effects, and playback behavior. Sidecar and embedded lyrics independently support line, word-timed, and enhanced LRC, with native TX QRC word timing. Each user can select enabled platforms per custom source, including independently configured shared sources.

<p align="center">
  <img src="docs/public/screenshots/web-settings.png" width="900" alt="Player settings and custom sources">
</p>

### 6. Service Status and Maintenance

The dashboard summarizes connections, users, uptime, and resource usage, with direct access to data, snapshots, WebDAV, logs, and maintenance tools.

<p align="center">
  <img src="docs/public/screenshots/admin-dashboard.png" width="900" alt="Management dashboard">
</p>

### 7. Users and Permissions

Create and manage sync accounts, identify administrator accounts, and keep each user's playlists, settings, custom sources, cache, and download directories isolated.

<p align="center">
  <img src="docs/public/screenshots/admin-users.png" width="900" alt="User management">
</p>

### 8. Server Configuration

Configure access paths, Subsonic, WebDAV, cache limits, proxies, and other server options from the dashboard. Docker environment variables retain the highest priority.

<p align="center">
  <img src="docs/public/screenshots/admin-config.png" width="900" alt="Server configuration">
</p>

### 9. Subsonic Protocol and Online Search

Connect clients such as Stream Music, LMP, and Feishin to the local library and playlists through the Subsonic API. Search supports `wy:`, `kg:`, `tx:`, `kw:`, and `mg:` platform prefixes, plus `online:` and `local:` scope prefixes.

## 🔒 Access Control & Security
The management dashboard is protected by `FRONTEND_PASSWORD`. Playlists, custom sources, downloads, and personal settings in the Web Player are authenticated through sync accounts and isolated per user. For public access, enable HTTPS and access control at the reverse proxy as well.

## 📱 Mobile Adaptation
The Web Player is deeply optimized for mobile devices, providing a native App-like experience in mobile browsers.

---

## 🚀 Quick Start

Built with **Node.js**, supporting multiple deployment methods.

Running from source requires Node.js `22.12.0` or later. Node.js 24 LTS is recommended.


### Option 1: Windows Client

The separate [Yinyun Windows client](https://github.com/bobcc4/yinyun-windows) connects to a server already deployed on your NAS. It signs in with the server URL, account username, and password, and keeps an encrypted local account snapshot for explicit disaster recovery. It does not start a second server on Windows.

### Option 2: Containerized Deployment via Docker

This project supports pulling images from Docker Hub or GitHub Packages:
- **Docker Hub**: `bobcc4/yinyun-lxserver:latest`
- **GitHub Packages**: `ghcr.io/bobcc4/yinyun-lxserver:latest`

> [!IMPORTANT]
> The stable Docker image now uses the `latest` tag, and the former `v1` tag no longer receives updates. Existing deployments must switch to `bobcc4/yinyun-lxserver:latest`. Every stable release also keeps an immutable full-version tag, such as `bobcc4/yinyun-lxserver:v1.5.4`, for version pinning and rollback. The data layout is unchanged, so keep the existing `/server/data`, `/server/logs`, `/server/cache`, and `/server/music` mounts.

**Docker Run Example:**

```bash
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  -v $(pwd)/cache:/server/cache \
  -v $(pwd)/music:/server/music \
  --name yinyun \
  --restart unless-stopped \
  bobcc4/yinyun-lxserver:latest
```

**Docker Compose Example:**

Create a `docker-compose.yml` file:

```yaml
services:
  yinyun:
    image: bobcc4/yinyun-lxserver:latest
    container_name: yinyun
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data
      - ./logs:/server/logs
      - ./cache:/server/cache
      - ./music:/server/music
    environment:
      NODE_ENV: production
      CONFIG_PATH: /server/data/config.js
```

Start the service:

```bash
docker compose up -d
```

Upgrade the image:

```bash
docker compose pull
docker compose up -d
```

Recreating the container does not remove mounted directories. Always keep `/server/data`, `/server/logs`, `/server/cache`, and `/server/music` mounted to persistent storage.

### Option 3: Manual Run (Git Clone)

```bash
# 1. Clone project
git clone https://github.com/bobcc4/yinyun-lxserver.git && cd yinyun-lxserver

# 2. Install dependencies and build
npm ci && npm run build

# 3. Start service
npm start
```

### Option 4: Using Release Build

1. Download the archive from GitHub Releases.
2. Extract and run `npm install --production`.
3. Execute `npm start`.

### 3. Access Info

- **Web Player**: `http://your-ip:9527/`
- **Management Console**: `http://your-ip:9527/admin` (default password: `123456`)
- **Subsonic**: `http://your-ip:9527/rest`

---

## 🏗️ Architecture

Separated frontend and backend architecture based on Node.js:

- **Backend (Node.js HTTP)**: Account APIs, media processing, Subsonic, and WebDAV backup.
- **Console (Vanilla JS)**: Fixed at `/admin`, handles user and data management.
- **WebPlayer (Vanilla JS)**: Fixed at `/`, handles music playback.

---

## 🛠️ Configuration

Edit `config.js` directly. Environment variables take precedence:

| Env Variable | Config Key | Description | Default |
| --- | --- | --- | --- |
| `PORT` | `port` | Service port | `9527` |
| `BIND_IP` | `bindIP` | Binding IP | `0.0.0.0` |
| `SUBSONIC_ENABLE` | `subsonic.enable` | Enable Subsonic protocol support | `true` |
| `SUBSONIC_PATH` | `subsonic.path` | Subsonic access path | `/rest` |
| `FRONTEND_PASSWORD` | `frontend.password` | Web dashboard password | `123456` |
| `SERVER_NAME` | `serverName` | Sync service name | `yinyun` |
| `MAX_SNAPSHOT_NUM` | `maxSnapshotNum` | Max snapshots to keep | `10` |
| `CONFIG_PATH` | - | Server configuration path; use `/server/data/config.js` with Docker | `<DATA_PATH>/config.js` |
| `DATA_PATH` | - | Absolute path to data storage directory | `./data` |
| `LOG_PATH` | - | Absolute path to log output directory | `./logs` |
| `PROXY_HEADER` | `proxy.header` | Proxy IP header (e.g., `x-real-ip`) | - |
| `WEBDAV_ENABLE` | `webdav.enable` | Enable WebDAV sync and backup | `false` |
| `WEBDAV_URL` | `webdav.url` | WebDAV URL | - |
| `WEBDAV_USERNAME` | `webdav.username` | WebDAV Username | - |
| `WEBDAV_PASSWORD` | `webdav.password` | WebDAV Password | - |
| `WEBDAV_SYNC_PATH` | `webdav.syncPath` | WebDAV remote sync path | `/lx-sync` |
| `WEBDAV_BACKUP_PATH` | `webdav.backupPath` | WebDAV remote backup path | `/lx-sync-backups` |
| `SYNC_INTERVAL` | `sync.interval` | WebDAV incremental sync interval (min) | `60` |
| `BACKUP_INTERVAL` | `sync.backupInterval` | WebDAV full backup interval (hours) | `24` |
| `DISABLE_TELEMETRY` | `disableTelemetry` | Disable anonymous telemetry and update notifications | `false` |
| `ENABLE_LOGIN_USER_CACHE_RESTRICTION` | `user.enableLoginCacheRestriction` | Enable cache settings restriction for logged-in non-admin users | `false` |
| `ENABLE_CACHE_SIZE_LIMIT` | `user.enableCacheSizeLimit` | Enable cache size limit (auto-cleanup via LRU) | `false` |
| `CACHE_SIZE_LIMIT` | `user.cacheSizeLimit` | Cache size limit in MB | `2000` |
| `LIST_ADD_MUSIC_LOCATION_TYPE` | `list.addMusicLocationType` | Position when adding songs to list (`top` / `bottom`) | `top` |
| `PROXY_ALL_ENABLED` | `proxy.all.enabled` | Enable outgoing request proxy (for Music SDK) | `false` |
| `PROXY_ALL_ADDRESS` | `proxy.all.address` | Proxy address (supports http:// or socks5://) | - |
| `SINGER_SOURCE_PRIORITY` | `singer.sourcePriority` | Singer info retrieval priority (e.g., `tx,wy` or `wy,tx`) | `tx,wy` |
| `LX_USER_<username>` | `users` array | Quickly add a user, value is the password (e.g., `LX_USER_test=123`) | - |

### Advanced Config Items (`config.js` Only)

Some advanced options are only configurable by directly editing `config.js`:

| Config Key | Description | Default |
| --- | --- | --- |
| `subsonic.enableDebug` | Enable Subsonic debug log mode | `true` |
| `subsonic.onlineSearch` | Enable Subsonic online global search | `true` |
| `subsonic.onlineSearchMode` | Subsonic online search mode (`fallback` / `merge` / `local_only`) | `"fallback"` |
| `subsonic.onlineSearchSources` | Subsonic online search default platforms | `"wy,tx,kw,kg,mg"` |
| `subsonic.lyricTranslation` | Include translation in Subsonic lyrics | `true` |
| `artist.maxFetchPages` | Maximum fetch pages for artist songs | `20` |
| `cache.namingPattern` | Cache file naming rule (`simple` / `custom`) | `"simple"` |
| `system.allowUnsafeVM` | Allow VM mode custom source scripts (note security risks) | `false` |

---

## 🛡️ Data Collection & Privacy

Anonymous telemetry via PostHog is used for:

1. **Bug Tracking**: Version number and environment type.
2. **Notifications**: **Update alerts** and **maintenance notices**.

- **Totally Anonymous**: No IP, username, or playlist content is collected.
- **How to Disable**: Set `DISABLE_TELEMETRY=true`. **Note: Disabling this prevents receiving update notifications.**

---

## 🤝 Credits & Acknowledgements

- Forked from [lyswhut/lx-music-sync-server](https://github.com/lyswhut/lx-music-sync-server).
- Web player logic inspired by [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop).
- API based on `musicsdk`.

### 👥 Contributors

<a href="https://github.com/bobcc4/yinyun-lxserver/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=bobcc4/yinyun-lxserver" />
</a>

## 📈 Star History

[![Star History Chart](md/star-history.svg)](https://github.com/bobcc4/yinyun-lxserver/stargazers)


---

## 📄 License

This project is released under the Apache License 2.0. The following agreement is a supplement to the Apache License 2.0. In case of conflict, this agreement shall prevail.

Apache License 2.0 copyright (c) 2026 [bobcc4](https://github.com/bobcc4)

**Terminology**: "This Project" refers to Yinyun; "User" refers to the user who agrees to this agreement; "Official Music Platforms" refers to the collective official platforms of the music sources built into this project, including Kuwo, Kugou, Migu, etc.; "Copyrighted Data" refers to data owned by others, including but not limited to images, audio, names, etc.

### I. Data Sources

1. **Official Platforms**: The online data from various official platforms in this project is pulled from their public servers. It is displayed after simple filtering and merging (the same as the data obtained from official apps in an unlogged state). Therefore, this project is not responsible for the legality or accuracy of the data.
2. **Audio Data**: This project itself does not have the ability to obtain specific audio data. The online audio data sources used come from the online links returned by the "Source" selected in the "Custom Source" settings. This project cannot verify its accuracy, and playback abnormalities may occur during use.
3. **Other Data**: Non-official platform data in this project (such as lists in "My List") comes from server-stored data. This project is not responsible for the legality or accuracy of this data.

### II. Disclaimer

1. **Copyrighted Data**: Copyrighted data may be generated during the use of this project. This project does not own ownership of this copyrighted data. To avoid infringement, users must clear the copyrighted data generated during the use of this project within **24 hours**.
2. **Liability**: Any direct, indirect, special, incidental, or consequential damages of any nature arising from this agreement or from the use or inability to use this project are the responsibility of the user.
3. **Laws and Regulations**: This project is completely free and open-sourced on GitHub for technical learning and exchange. Use of this project in violation of local laws and regulations is **PROHIBITED**. The user shall bear full responsibility for any illegal or non-compliant behavior caused by using this project, whether the user is aware of local laws and regulations or not.

### III. Miscellaneous

1. **Resource Usage**: Some resources used in this project, including but not limited to fonts and images, come from the internet. If there is any infringement, please contact this project for removal.
2. **Non-Commercial Nature**: This project is only for technical feasibility exploration and research. It does not accept any commercial cooperation (including but not limited to advertising) or donations.
3. **Acceptance of Agreement**: If you use this project, it means you accept this agreement.
