# Quick Start Deployment Guide

Welcome to Yinyun, a self-hosted music server for Web playback, downloads, local-library management, Windows account snapshots, and Subsonic clients.

## Infrastructure Dependencies

Before starting this service project, please ensure that the host system (or virtual machine, containerized facility) carrying this instance meets the following minimum prerequisites:

**Running Directly from Source:**

- **Node.js**: `v22.12.0` or later (Node.js 24 LTS is recommended for production).
- **Network Resources**: Ensure that the listening port required for the business (default configuration is `9527`) has been correctly allowed in the host firewall policy and the cloud provider's security group rules.

**Running on Containerized Facilities (Preferred for Production):**

- `Docker Engine` runtime.
- `Docker Compose` (required when involving declarative service orchestration).

---

## Deployment Execution Plan and Best Practices

### Option 1: Windows Client

After deploying the NAS server, install the separate [Yinyun Windows client](https://github.com/bobcc4/yinyun-windows). It connects with the server URL, account username, and password, and keeps an encrypted local account snapshot. The client does not run a second server on Windows.

### Option 2: Containerized Deployment Based on Docker Engine

This project supports pulling images from Docker Hub or GitHub Packages:

- **Docker Hub**: `bobcc4/yinyun-lxserver:latest`
- **GitHub Packages**: `ghcr.io/bobcc4/yinyun-lxserver:latest`

> [!IMPORTANT]
> The stable Docker image now uses the `latest` tag, and the former `v1` tag no longer receives updates. Existing deployments must switch to `bobcc4/yinyun-lxserver:latest`. Every stable release also keeps an immutable full-version tag, such as `bobcc4/yinyun-lxserver:v1.5.3`, for version pinning and rollback. Keep the current four volume mounts; no data migration is required.

Execute the following command to start the container:

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

**Container Volume Mappings:**

- `-v $(pwd)/data:/server/data`: This configuration is a **core mandatory item**. It is responsible for exporting all application-layer state data generated within the instance to the host for persistent storage.
- `-v $(pwd)/logs:/server/logs`: A physical mount point used to receive and output all graded audit logs of the service.
- `-v $(pwd)/cache:/server/cache`: Used to store music cache files, significantly improving loading speed during repeated playback.
- `-v $(pwd)/music:/server/music`: **Used exclusively for storing downloaded songs.**

**Docker Compose deployment:**

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
      # External music library; configure the library name in the admin console first
      # - /volume1/media/music:/server/external/admin/bendigequ:ro
    environment:
      - NODE_ENV=production
      - CONFIG_PATH=/server/data/config.js
```

Use the `- KEY=value` list syntax consistently under `environment`. Keep the same indentation when adding variables; do not mix it with `KEY: value` mapping syntax.

### External music libraries

If your music already exists elsewhere on the NAS, do not move it. In **System Configuration -> External music libraries**, choose the sync user and a library name. For `admin` and `bendigequ`, mount the host directory as:

```yaml
- /volume1/media/music:/server/external/admin/bendigequ:ro
```

After recreating the container, rescan the library. Nested directories are supported, and the tracks are available in Local Music, the Web player, and Subsonic. External libraries are read-only: they are excluded from downloads, cache cleanup, remastering, renaming, and metadata writes. The index is stored under `/server/data/external-index`; removing the configuration never deletes host files.

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

### Option 2: Source Compilation Deployment Based on Physical Environment

For restricted non-containerized environments or secondary research and development expansion scenarios, you need to assemble and pull up the process directly on the operating system:

```bash
# 1. Extract the code from the remote code repository to the current directory in the Main branch state
git clone https://github.com/bobcc4/yinyun-lxserver.git
cd lxserver

# 2. Call the strict analysis process to initialize the module dependency library
npm ci 

# 3. Perform pre-compilation aggregation processing on TypeScript types and Vue DOM templates
npm run build

# 4. Execute the production node start command based on the built-in scheduler
npm start
```

*Engineering Practice Tip: For native application hosting in unattended server environments, use a process supervisor such as `pm2`: `pm2 start npm --name "yinyun" -- start`.*

---

## Load Front-end and Nginx Reverse Proxy Access Strategy

Before exposing it to the public network main process node, it is strongly recommended to connect a mature Web daemon gateway instance. This is intended to securely apply SSL encryption and hide internal distribution port features.

The following is a standardized Nginx reverse proxy example for audio Range streaming, `/api/v1`, and source IP forwarding from ports `80 / 443` to service port `9527`:

```nginx
server {
    listen 80;
    server_name music.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:9527;
  
        # Define the Header transmission policy to ensure that the Node layer can get the client's public network layer IP
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  
        # Complement the long-connection upgrade feature definition (necessary condition for internal synchronization communication socket services)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## Verify the Health of Delivered Components

After the service instance registration and scheduling are completed, and the traffic tunnel is established, administrators can check the connectivity status of the two sub-service systems in the browser respectively:

| Module System Identifier                             | Deployment Application Node Level | Default Domain Check                                                                                                                                            | Core Application Capabilities and Infrastructure                                                                                                                     |
| ---------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web Player**                                  | `/`                             | Sync account username and password                                                                                                                           | Search, playback, playlists, downloads, and local-library access.                                                                                                      |
| **Management Console**                          | `/admin`                        | Default administrator password: `123456`                                                                                                                     | Manage accounts, sources, storage, configuration, backups, and service status.                                                                                         |
| **Subsonic API**                                | `/rest`                         | Sync account username and password                                                                                                                           | Connect third-party Subsonic-compatible clients.                                                                                                                       |

Starting with v1.5.0, `/` and `/admin` are fixed entry points. The former `/music` Web route has been removed without a redirect. This does not change the `/server/music` persistent audio directory.

For more advance details on implementing silent import of underlying variables in the early lifecycle of instantiation, and configuration hierarchy rewriting, please move to read "[Configuration Engine and Environment Variable Injection Guide](./configuration.md)".
