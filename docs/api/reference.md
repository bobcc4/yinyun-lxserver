# 服务端 API 参考

音云提供多种 RESTful 风格的 API 接口，用于自动化获取和操作同步服务器数据及状态。

## 概述

为了确保安全性，API 要求进行鉴权。目前主要支持以下两种鉴权方式：

1. **管理员鉴权 (`x-frontend-auth`)**: 使用管理终端的全局口令（`frontend.password`）。用于敏感的服务控制、用户管理及全局数据提取。
2. **用户 Token 鉴权 (`x-user-token`)**: 使用通过登录接口获取的动态 Session Token 或管理面板生成的持久化 API Token。用于操作特定用户的数据（如歌单、设置、缓存等）。

所有接口如无特殊说明均**使用 JSON 作为请求体及响应体**类型 (`Content-Type: application/json`)。

---

## 1. 认证与账户管理 API

### 1.1 管理员：服务状态 (`GET /api/v1/admin/status`)

获取同步服务器整体内存消耗、设备在线情况、运行时间汇总状态。

- **Header Auth**: `x-frontend-auth: <Admin Password>`

### 1.2 管理员：用户管理 (`/api/v1/admin/users`)

- **Header Auth**: `x-frontend-auth: <Admin Password>`
- `GET /api/v1/admin/users`: 获取所有用户列表及密码。
- `POST /api/v1/admin/users`: 创建新用户 (`{"name": "...", "password": "..."}`)。
- `PUT /api/v1/admin/users`: 修改用户信息 (重命名或修改密码) (`{"name": "原用户名", "newName": "新用户名", "password": "新密码"}`)。
- `DELETE /api/v1/admin/users`: 删除用户 (`{"names": ["..."], "deleteData": true}`)。

### 1.3 用户：登录获取 Token (`POST /api/v1/player/user/login`)

使用用户名密码登录并颁发 Token。

- **Body**: `{"username": "...", "password": "..."}`
- **响应**: `{"success": true, "token": "lx_tk_...", "username": "..."}`

### 1.4 用户：登出 (`POST /api/v1/player/user/logout`)

注销当前的 Session Token。

- **Header Auth**: `x-user-token: <Token>`

### 1.5 用户：认证有效性检查 (`GET /api/v1/player/user/auth/verify`)

检查当前 Token 是否还有效。

- **Header Auth**: `x-user-token: <Token>`

---

## 2. Token 安全管理 API

用于在管理面板或客户端管理持久化的 API Token。要求使用 `x-user-token` 进行鉴权。

- `GET /api/v1/player/user/token/config`: 获取当前用户的持久化 API Token 配置（是否开启及列表）。
- `POST /api/v1/player/user/token/config`: 开启或关闭持久化 API Token 功能 (`{"enabled": true/false}`)。
- `POST /api/v1/player/user/token/add`: 生成新的持久化 API Token (`{"name": "名称", "expireDays": 7}`)。
- `POST /api/v1/player/user/token/remove`: 删除指定 Token (`{"token": "..."}`)。
- `POST /api/v1/player/user/token/update`: 更新 Token 信息（名称、有效期）。
- `POST /api/v1/player/user/token/toggle`: 禁用或启用某个已生成的 Token。
- `GET /api/v1/player/user/token/logs`: 获取特定 Token 的审计/访问日志（需传入 `tokenMasked` 参数）。

---

## 3. 数据与同步 API

此类接口用于管理用户的核心同步数据。

### 3.1 歌单管理

- `GET /api/v1/player/user/list`: 获取用户当前完整歌单数据。
- `POST /api/v1/player/user/list`: 全量覆盖更新用户歌单数据（会触发同步广播）。
- `POST /api/v1/player/music/user/list/remove`: 批量删除指定歌单中的歌曲 (`{"listId": "...", "songIds": [...]}`)。

### 3.2 历史快照 (Snapshot)

- `GET /api/v1/admin/data/snapshots`: 获取快照列表。
- `GET /api/v1/admin/data/snapshot`: 获取特定快照的数据。
- `POST /api/v1/admin/data/restore-snapshot`: 恢复到指定快照。
- `POST /api/v1/admin/data/delete-snapshot`: 删除特定快照。
- `POST /api/v1/admin/data/upload-snapshot`: 手动上传备份快照。

### 3.3 用户设置与音效

- `GET /api/v1/player/user/settings`: 获取用户应用设置。
- `POST /api/v1/player/user/settings`: 更新用户应用设置。
- `GET /api/v1/player/user/sound-effects`: 获取用户均衡器/音效设置。
- `POST /api/v1/player/user/sound-effects`: 更新用户音效设置。

---

## 4. 多媒体核心 API (Web Player 支持)

### 4.1 搜索与提示

- `GET /api/v1/player/music/search`: 音乐搜索（支持 `kw`, `kg`, `tx`, `wy`, `mg`）。
- `GET /api/v1/player/music/tipSearch`: 搜索关键词联想提示。
- `GET /api/v1/player/music/hotSearch`: 各平台实时热搜榜单。

### 4.2 广场与榜单

- `GET /api/v1/player/music/songList/tags`: 获取歌单分类标签。
- `GET /api/v1/player/music/songList/list`: 获取指定标签的精选歌单列表。
- `GET /api/v1/player/music/songList/detail`: 获取歌单详情（完整歌曲列表）。
- `GET /api/v1/player/music/leaderboard/boards`: 获取排行榜分类。
- `GET /api/v1/player/music/leaderboard/list`: 获取排行榜内的歌曲。

### 4.3 播放与歌词

- `POST /api/v1/player/music/url`: 获取音乐播放直链。
  - **Header Support**: 可选 `x-req-id` 用于 SSE 进度追踪。
  - **Progress**: 可通过 `GET /api/v1/player/music/progress?reqId=xxx` 订阅 SSE 获取自定义源解析进度。
- `POST /api/v1/player/music/lyric`: 获取歌词。
- `POST /api/v1/player/music/comment`: 获取歌曲评论（支持 hot/new 类型）。

### 4.4 下载与转发 (`GET /api/v1/player/music/download`)

代理下载音乐文件，支持自动注入 ID3 标签。

- **Params**: `url`, `filename`, `tag=1` (注入标签), `name`, `singer`, `album`, `pic`。

---

## 5. 服务端文件缓存 API

用户可以通过接口管理缓存在服务器上的音乐文件和歌词。

- `GET /api/v1/player/music/cache/stats`: 获取当前用户的缓存统计（文件数、占用空间）。
- `GET /api/v1/player/music/cache/list`: 获取详细的缓存文件列表。
- `POST /api/v1/player/music/cache/download`: 触发服务器后台下载歌曲并缓存。
- `POST /api/v1/player/music/cache/remove`: 删除指定的缓存文件。
- `POST /api/v1/player/music/cache/clear`: 清理所有音乐缓存。
- `POST /api/v1/player/music/cache/lyric`: 保存或读取歌词缓存。

---

## 6. 自定义源管理 API

- `GET /api/v1/player/custom-source/list`: 获取已导入的自定义源列表。
- `POST /api/v1/player/custom-source/import`: 在线导入自定义源脚本。
- `POST /api/v1/player/custom-source/upload`: 上传本地脚本文件。
- `POST /api/v1/player/custom-source/toggle`: 启用或禁用某个源。
- `POST /api/v1/player/custom-source/delete`: 删除自定义源。
- `POST /api/v1/player/custom-source/reorder`: 对自定义源进行排序。

---

## 7. 全局系统配置 API (管理员权限)

用于管理后台对服务器核心行为的实时调整。要求 `x-frontend-auth` 鉴权。

- `GET /api/v1/admin/config`: 获取服务器当前的所有可配置项（含环境变量覆盖后的最终值）。
- `POST /api/v1/admin/config`: 增量更新全局配置。
  - **参数示例**: `{"singer.sourcePriority": ["tx", "wy"]}`
  - **验证**: 某些字段（如 `singer.sourcePriority`）会进行合法性校验。

### 7.1 外部音乐库

- `GET /api/v1/admin/external-libraries`: 获取已登记的外部音乐库。
- `POST /api/v1/admin/external-libraries`: 手动登记用户和库名称。
- `GET /api/v1/admin/external-libraries/discover`: 扫描 `/server/external/<用户名>/<库名称>` 下已挂载的目录，只返回发现结果，不自动登记。
- `POST /api/v1/admin/external-libraries/import`: 确认导入一个已发现目录并立即扫描索引。
- `POST /api/v1/admin/external-libraries/<ID>/rescan`: 重新扫描指定外部音乐库。
- `DELETE /api/v1/admin/external-libraries/<ID>`: 删除配置和索引，不删除宿主机文件。

---

## 8. Web 播放器专属 API

专为 Web 播放器前端逻辑设计的接口。涉及用户数据的请求使用同步账户 Token 鉴权。

### 8.1 运行配置

### 8.2 增强元数据详情
- `GET /api/v1/player/music/artistDetail`: 获取歌手精美详情。
  - **Params**: `source` (tx/wy), `id` (歌手Mid/ID)。
  - **Return**: 含 `name`, `desc`, `avatar`, `fans` 等。
- `GET /api/v1/player/music/artistAlbums`: 分页获取歌手的专辑列表。
- `GET /api/v1/player/music/artistSongs`: 分页获取歌手的全部歌曲。
- `GET /api/v1/player/music/albumSongs`: 获取指定专辑内的所有音轨详情。

### 8.3 实时进度 (SSE)
- `GET /api/v1/player/music/progress?reqId=xxx`: 通过 Server-Sent Events (SSE) 实时订阅外链解析、缓存进度等流式信息。
