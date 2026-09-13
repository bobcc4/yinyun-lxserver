---
layout: home

hero:
  name: "音云 Yinyun"
  text: "使用帮助"
  tagline: "部署、同步、播放、下载、曲库管理和第三方客户端连接手册"
  image:
    src: /icon.svg
    alt: Yinyun
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/getting-started
    - theme: alt
      text: 浏览全部功能
      link: /guide/features

features:
  - title: 部署与管理
    details: Docker、Windows 客户端、源码部署、数据持久化、用户管理、快照、WebDAV 和日志排查。
    link: /guide/getting-started
  - title: Web 播放与下载
    details: 多平台搜索、八档音质、播放队列、歌词、音效、服务器下载、缓存和断点续传队列。
    link: /guide/web-player
  - title: 本地曲库
    details: 多层目录扫描、布尔搜索、批量筛选、元数据与封面歌词补全、歌单收藏和歌曲洗版。
    link: /guide/library-downloads
  - title: 多端连接
    details: Windows 加密账户快照与灾难恢复，以及音流、LMP、Feishin 等 Subsonic 客户端接入。
    link: /guide/accounts-sync
  - title: 歌单分享与音源
    details: 音云服务端之间通过链接或 JSON 分享歌单，导入前预览匹配结果；同时支持管理员音源共享、自定义源隔离、代理与安全设置。
    link: /guide/sharing
  - title: 故障排查
    details: 登录、播放、下载、曲库扫描、歌词封面、Subsonic 和桌面客户端常见问题。
    link: /guide/troubleshooting

---

::: tip 项目地址与推荐使用方式

**服务端：** [bobcc4/yinyun-lxserver](https://github.com/bobcc4/yinyun-lxserver)

支持使用 Docker 搭建，也提供 Windows、macOS 等平台的安装包。

**Windows 客户端：** [bobcc4/yinyun-windows](https://github.com/bobcc4/yinyun-windows)

当前仅制作了 Windows 客户端；其他平台更推荐使用成熟的第三方客户端。

建议在 NAS 或服务器上通过 Docker 部署音云服务端，再使用音流、箭头音乐等支持 Subsonic 的第三方客户端连接。客户端填写服务端 `IP:端口`，并使用音云用户名和密码登录即可。

使用 Lucky 等工具进行反向代理时，请确保放行 `/rest/*` 路径。

**交流群：** [点击加入音云 issue 反馈群](https://qm.qq.com/q/MW7cns1eMe)

:::

## 使用顺序

1. 按照[快速开始](/guide/getting-started)完成部署和目录持久化。
2. 修改默认管理密码，创建同步用户并确认播放器登录正常。
3. 阅读[账户与 Windows 同步](/guide/accounts-sync)或[Subsonic 客户端](/guide/subsonic)连接其他设备。
4. 下载前阅读[本地曲库与下载](/guide/library-downloads)，明确 `/cache` 与 `/music` 的区别。

::: warning Docker 标签迁移
正式镜像使用 `bobcc4/yinyun-lxserver:latest`。原 `v1` 标签已停止更新，现有用户必须修改 Compose 或 NAS 容器配置。完整版本标签会永久保留，可用于锁定版本和回滚。
:::

## 界面预览

![Web 播放器在线搜索页面](/screenshots/web-search.png)

Web 播放器可在同一界面完成平台选择、在线搜索、播放、收藏和下载。

![服务器管理后台仪表盘](/screenshots/admin-dashboard.png)

管理后台集中显示服务状态、资源占用、用户和服务器维护入口。
