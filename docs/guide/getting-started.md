# 快速开始

音云服务端适合个人 NAS、单用户或少量用户使用。下载与缓存文件使用可读文件名，能够直接在 NAS 文件系统中查看和管理。

## 部署前准备

- 推荐：Docker 24 或更高版本、Docker Compose v2。
- 源码运行：Node.js 22.12 或更高版本，推荐 Node.js 24 LTS。
- 默认端口：`9527`。
- 正式镜像：`bobcc4/yinyun-lxserver:latest`。
- 至少持久化 `/server/data`；需要下载和管理源文件时，还应持久化 `/server/cache`、`/server/music` 和 `/server/logs`。

> [!IMPORTANT]
> Docker 正式镜像已改用 `latest` 标签，原 `v1` 标签停止更新。已有部署必须改为 `bobcc4/yinyun-lxserver:latest`。每次正式发布还会保留完整版本标签，例如 `bobcc4/yinyun-lxserver:v1.5.3`，用于锁定版本或回滚。请保留原来的四个目录挂载，不需要迁移数据。

## Docker Compose 部署

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
      # 外部音乐库：先在管理后台配置库名称，再按显示路径只读挂载
      # - /volume1/media/music:/server/external/admin/bendigequ:ro
    environment:
      NODE_ENV: production
      CONFIG_PATH: /server/data/config.js
```

### 外部音乐库

如果歌曲已经位于 NAS 的其他目录，不需要移动文件。进入管理后台 **系统配置 → 外部音乐库**，点击“扫描已挂载目录”，确认发现的目录后选择“导入并扫描”。系统会自动识别 `/server/external/<用户名>/<库名称>` 下已挂载的目录；也可以手动选择同步用户并填写库名称，例如 `bendigequ`。系统会显示固定容器路径 `/server/external/admin/bendigequ`。在 Compose 中加入：

```yaml
- /volume1/media/music:/server/external/admin/bendigequ:ro
```

其中 `admin` 必须是同步账户用户名，`bendigequ` 必须与后台配置一致。重建容器后点击 **重新扫描**，外部目录中的音频（包括多层子目录）会出现在本地音乐、网页播放和 Subsonic 曲库中。外部库默认只读，不参与下载、缓存清理、洗版、重命名或元数据写入；删除后台配置不会删除宿主机文件。索引保存在 `/server/data/external-index`，不会写入外部音乐目录。

启动：

```bash
docker compose up -d
```

升级：

```bash
docker compose pull
docker compose up -d
```

升级容器不会删除已挂载目录。不要在未确认挂载正确前删除旧容器数据。

## Windows 客户端

服务端部署完成后，可从 [Windows 客户端 Releases](https://github.com/bobcc4/yinyun-windows/releases/latest) 下载安装包。客户端只连接 NAS 服务端，不在电脑上启动第二套服务器；详细说明见[Windows 客户端](/guide/desktop)。

## 源码运行

```bash
git clone https://github.com/bobcc4/yinyun-lxserver.git
cd yinyun-lxserver
npm ci
npm run build
npm start
```

源码部署需要自行负责进程守护、开机启动和数据目录持久化。

## 首次访问

| 功能 | 默认地址 | 默认凭据 |
| --- | --- | --- |
| Web 播放器 | `http://服务器IP:9527/` | 同步账户 `admin` / `password` |
| 管理后台 | `http://服务器IP:9527/admin` | 管理密码 `123456` |
| Subsonic | `http://服务器IP:9527/rest` | 同步账户用户名与密码 |

首次登录后立即完成以下操作：

1. 在管理后台修改默认管理密码。
2. 修改 `admin` 同步账户密码，或创建自己的同步账户。
3. 确认 `/data`、`/cache`、`/music`、`/logs` 均映射到 NAS 持久化目录。
4. 登录 Web 播放器并导入仅来自可信来源的音源脚本。
5. 需要外网访问时配置 HTTPS 反向代理，不要直接暴露管理后台。

## 访问路径说明

- Web 播放器固定使用根路径 `/`。
- 管理后台固定使用 `/admin`。
- v1.5.0 起旧 `/music` 网页入口已删除，不提供重定向。
- `SUBSONIC_PATH` 修改 Subsonic 路径，默认 `/rest`。
- Windows 客户端填写服务根地址，并使用同步账户用户名和密码登录。

这里的网页入口与 NAS 音频目录不同：`/server/music` 仍是下载曲库的容器持久化目录，不会因网页路径调整而变化。

## 反向代理要点

反向代理应转发完整站点根路径，并支持 Range 请求、较长的流媒体连接，同时放行 `/api/v1` 与 `/rest`。不要只把上游配置成旧 `/music` 子路径。建议保留以下请求头：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_http_version 1.1;
proxy_read_timeout 3600s;
```

## 部署检查

1. 管理后台能够登录并显示服务状态。
2. Web 播放器能使用同步账户登录。
3. 下载一首测试歌曲后，NAS 的 `music/<用户名>` 中出现音频文件。
4. 清理缓存时只影响 `cache/<用户名>`，不影响下载目录。
5. 重建容器后，账户、歌单、设置和下载队列仍存在。

遇到异常请先查看[故障排查](/guide/troubleshooting)。
