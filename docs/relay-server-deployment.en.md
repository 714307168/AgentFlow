# Relay Server Deployment

[中文](./relay-server-deployment.md)

This document is meant for the public repository. Replace all domains, IPs, usernames, and passwords with your own values.

## Scope

This guide covers deploying `relay-server/` to a public Linux host with:

- WebSocket relay
- user login and device authentication
- admin UI
- update center

## Requirements

- Linux x86_64
- `systemd`
- Go `1.25.x`
- a reverse proxy such as Nginx or Caddy
- a public domain such as `relay.example.com`

Notes:

- `relay-server` listens on plain HTTP by default; for public deployments, terminate HTTPS / WSS at the reverse proxy
- the server uses SQLite and is designed for single-node deployment

## Recommended Directories

```text
/opt/agentflow/relay-server/        source and build output
/var/lib/agentflow-relay/           persistent data
/etc/relay/relay.env                environment file
/etc/systemd/system/relay.service   systemd unit
```

## 1. Clone the Repository

```bash
git clone https://github.com/<your-org>/AgentFlow.git
cd AgentFlow/relay-server
```

## 2. Build and Test

```bash
go test ./...
go build -o relay-server .
```

The build output will be:

```text
relay-server/relay-server
```

## 3. Create the Service User and Data Directories

```bash
sudo useradd --system --home /var/lib/agentflow-relay --shell /usr/sbin/nologin relay
sudo mkdir -p /opt/agentflow/relay-server
sudo mkdir -p /var/lib/agentflow-relay
sudo mkdir -p /etc/relay
sudo chown -R relay:relay /var/lib/agentflow-relay
```

## 4. Configure Environment Variables

Create `/etc/relay/relay.env`:

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

Important notes:

- `JWT_SECRET` must not use the default `change-me-in-production`
- do not use `CORS_ORIGINS=*` on a public deployment
- if HTTPS is terminated by Nginx or Caddy, leave `TLS_CERT` and `TLS_KEY` empty
- `ADMIN_USER` and `ADMIN_PASSWORD` are kept for bootstrap and backward compatibility
  if you keep them in the env file, that account password will be re-synced on every restart
  after initial setup, it is better to change the password in the admin UI and remove them

## 5. Install the systemd Service

The repository already includes a service template:

- [relay.service](../relay-server/deploy/relay.service)

Install it with:

```bash
sudo cp relay-server /usr/local/bin/relay-server
sudo chmod +x /usr/local/bin/relay-server
sudo cp deploy/relay.service /etc/systemd/system/relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now relay
```

Check the service:

```bash
sudo systemctl status relay
sudo journalctl -u relay -f
```

## 6. Configure the Reverse Proxy

For public deployments, Nginx is the recommended way to terminate HTTPS and forward WebSocket traffic.

Example:

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
    }
}
```

Notes:

- `client_max_body_size 200m` leaves enough room for APK and installer uploads in the update center
- lower it if you do not use the update center

## 7. First Startup Checks

After starting the service, verify:

```bash
curl http://127.0.0.1:8080/health
curl https://relay.example.com/health
```

Expected response:

```text
ok
```

Admin UI:

```text
https://relay.example.com/admin
```

Update check examples:

```text
https://relay.example.com/api/update/check?platform=android&channel=stable&arch=&version=1.0.0&build=1
https://relay.example.com/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.0.0&build=0
```

## 8. Upgrade Procedure

Typical upgrade flow:

```bash
cd /opt/agentflow/relay-server/relay-server
git pull
go test ./...
go build -o relay-server .
sudo cp relay-server /usr/local/bin/relay-server
sudo systemctl restart relay
sudo journalctl -u relay -n 100 --no-pager
```

If the release includes database changes:

- SQLite migrations run automatically on startup
- still back up `relay.db` before upgrading

## 9. Backup Recommendations

At minimum, back up:

- `/var/lib/agentflow-relay/relay.db`
- `/var/lib/agentflow-relay/releases/`
- `/etc/relay/relay.env`

## 10. Security Recommendations

- run the service as a dedicated Linux user instead of `root`
- use a strong random `JWT_SECRET`
- expose only `443` publicly and keep the relay bound behind the reverse proxy
- restrict `CORS_ORIGINS` to the real client origins
- never commit `ADMIN_PASSWORD`, database files, or local publish scripts
- if you do not need in-process TLS, keep certificates only in the reverse proxy layer

## Related Docs

- [Architecture Overview](./architecture-overview.md)
- [Release and Update Center](./release-and-update-center.md)
- [Release Upload Runbook](./release-upload-runbook.md)
- [GitHub Releases Publishing](./github-releases.md)
