# Relay Server 部署

[English](./relay-server-deployment.en.md)

这份文档用于公开仓库，所有域名、IP、账号、密码都请替换为你自己的环境值。

## 适用范围

适用于将 `relay-server/` 部署到一台公开可访问的 Linux 服务器，并提供：

- WebSocket 中继
- 用户登录与设备鉴权
- 管理后台
- 更新中心

## 运行要求

- Linux x86_64
- `systemd`
- Go `1.25.x`
- 一个反向代理，例如 Nginx 或 Caddy
- 一个公开域名，例如 `relay.example.com`

说明：

- `relay-server` 默认监听 HTTP 端口，公开部署时建议由反向代理负责 HTTPS / WSS
- 数据库使用 SQLite，适合单机部署

## 目录建议

推荐使用以下目录：

```text
/opt/agentflow/relay-server/        代码和构建产物
/var/lib/agentflow-relay/           数据目录
/etc/relay/relay.env                环境变量文件
/etc/systemd/system/relay.service   systemd 服务文件
```

## 1. 拉取代码

```bash
git clone https://github.com/<your-org>/AgentFlow.git
cd AgentFlow/relay-server
```

## 2. 编译和测试

```bash
go test ./...
go build -o relay-server .
```

构建完成后可执行文件为：

```text
relay-server/relay-server
```

## 3. 创建运行用户和数据目录

```bash
sudo useradd --system --home /var/lib/agentflow-relay --shell /usr/sbin/nologin relay
sudo mkdir -p /opt/agentflow/relay-server
sudo mkdir -p /var/lib/agentflow-relay
sudo mkdir -p /etc/relay
sudo chown -R relay:relay /var/lib/agentflow-relay
```

## 4. 配置环境变量

创建 `/etc/relay/relay.env`：

```bash
PORT=8080
JWT_SECRET=replace-with-a-long-random-secret
LOG_LEVEL=info
PING_INTERVAL=30
QUEUE_SIZE=100
CORS_ORIGINS=https://relay.example.com,https://app.example.com
DATA_DIR=/var/lib/agentflow-relay
DATABASE_PATH=/var/lib/agentflow-relay/relay.db

# Optional bootstrap admin account.
# If both values stay in the env file, the password will be synced on every restart.
ADMIN_USER=admin
ADMIN_PASSWORD=replace-with-a-strong-password

# Optional if relay-server terminates TLS itself.
# TLS_CERT=/etc/letsencrypt/live/relay.example.com/fullchain.pem
# TLS_KEY=/etc/letsencrypt/live/relay.example.com/privkey.pem
```

关键说明：

- `JWT_SECRET` 不能使用默认值 `change-me-in-production`
- `CORS_ORIGINS` 公开部署不要设成 `*`
- 如果你使用 Nginx/Caddy 做 HTTPS 终止，`TLS_CERT` 和 `TLS_KEY` 可以不填
- `ADMIN_USER` 和 `ADMIN_PASSWORD` 只是兼容启动项
  如果长期保留，每次服务启动都会同步这个账号密码
  更推荐首启后在后台改密码，然后移除这两个环境变量

## 5. 安装 systemd 服务

仓库内已经提供了服务模板：

- [relay.service](../relay-server/deploy/relay.service)

部署方式：

```bash
sudo cp relay-server /usr/local/bin/relay-server
sudo chmod +x /usr/local/bin/relay-server
sudo cp deploy/relay.service /etc/systemd/system/relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now relay
```

查看状态：

```bash
sudo systemctl status relay
sudo journalctl -u relay -f
```

## 6. 配置反向代理

公开部署推荐用 Nginx 做 HTTPS 和 WebSocket 转发。

示例：

```nginx
server {
    listen 80;
    server_name relay.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    client_max_body_size 200m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8080/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
        proxy_connect_timeout 15s;
        proxy_buffering off;
    }
}
```

说明：

- `client_max_body_size 200m` 是给更新中心上传安装包/APK 预留的
- 如果你不用更新中心，可以按需调小

## 7. 首次启动检查

启动后先检查：

```bash
curl http://127.0.0.1:8080/health
curl https://relay.example.com/health
```

预期返回：

```text
ok
```

后台入口：

```text
https://relay.example.com/admin
```

更新中心接口检查：

```text
https://relay.example.com/api/update/check?platform=android&channel=stable&arch=&version=1.0.0&build=1
https://relay.example.com/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.0.0&build=0
```

## 8. 升级方式

常规升级步骤：

```bash
cd /opt/agentflow/relay-server/relay-server
git pull
go test ./...
go build -o relay-server .
sudo cp relay-server /usr/local/bin/relay-server
sudo systemctl restart relay
sudo journalctl -u relay -n 100 --no-pager
```

如果有数据库变更：

- 服务启动时会自动执行 SQLite 迁移
- 升级前仍建议备份 `relay.db`

## 9. 备份建议

至少备份以下内容：

- `/var/lib/agentflow-relay/relay.db`
- `/var/lib/agentflow-relay/releases/`
- `/etc/relay/relay.env`

## 10. 安全建议

- 使用独立 Linux 用户运行服务，不要直接用 `root`
- `JWT_SECRET` 必须是足够长的随机串
- 公开部署时只允许反向代理暴露 `443`
- `CORS_ORIGINS` 只填实际需要的来源
- 生产环境不要把 `ADMIN_PASSWORD`、数据库文件、发布脚本提交到仓库
- 如果不需要服务端直出 TLS，就只在反向代理层配置证书

## 相关文档

- [架构概览](./architecture-overview.md)
- [更新中心与发布说明](./release-and-update-center.md)
- [发布上传 Runbook](./release-upload-runbook.md)
- [GitHub Releases 发布](./github-releases.md)
