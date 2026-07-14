# Deployment Guide

MAPS is a single Node.js process that serves both the API and the frontend and
stores data in a local SQLite file. This makes it easy to run on a small cloud
server for a demo. Below is a step-by-step guide for **AWS EC2**, plus general
notes that apply to any host.

---

## Environment variables

Configure these in a `.env` file (copy `.env.example`) or as real environment
variables on the host:

| Variable         | Default              | Notes                                              |
|------------------|----------------------|----------------------------------------------------|
| `PORT`           | `3000`               | Port the server listens on                         |
| `JWT_SECRET`     | (dev fallback)       | **Set a long random string in production**         |
| `JWT_EXPIRES_IN` | `7d`                 | Token lifetime                                     |
| `DB_PATH`        | `data/maps.db`       | SQLite file location                               |
| `NODE_ENV`       | `development`        | Set to `production` on a server                    |

Generate a strong secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Option A — AWS EC2 (used for the class demo)

### 1. Launch an instance
- **AMI:** Amazon Linux 2023 (or Ubuntu 22.04)
- **Type:** `t2.micro` / `t3.micro` (free-tier eligible) is plenty
- **Security group:** allow inbound **SSH (22)** from your IP and **HTTP (80)**
  and a custom TCP rule for **3000** from anywhere (or just 80 if you use the
  Nginx step below)

### 2. Install Node.js
SSH in, then:

```bash
# Amazon Linux 2023
sudo dnf install -y nodejs git
# (Ubuntu:  sudo apt update && sudo apt install -y nodejs npm git)
node --version   # confirm 18+
```

If the distro's Node is older than 18, install a current version with nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
. ~/.nvm/nvm.sh && nvm install 20
```

### 3. Get the code and set it up

```bash
git clone https://github.com/gil10101/MAPS-System.git
cd MAPS-System
npm install
cp .env.example .env
# Edit .env: set NODE_ENV=production and a real JWT_SECRET
npm run seed        # load demo data for the presentation
```

### 4. Run it as a background service (systemd)

Create `/etc/systemd/system/maps.service`:

```ini
[Unit]
Description=MAPS scheduling system
After=network.target

[Service]
Type=simple
# Adjust User and WorkingDirectory to match your instance
User=ec2-user
WorkingDirectory=/home/ec2-user/MAPS-System
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now maps
sudo systemctl status maps      # verify it's running
```

The app is now at `http://<your-ec2-public-ip>:3000`.

### 5. (Optional) Serve on port 80 with Nginx

So visitors don't need to type `:3000`:

```bash
sudo dnf install -y nginx        # or: sudo apt install -y nginx
```

Create `/etc/nginx/conf.d/maps.conf`:

```nginx
server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo systemctl enable --now nginx
sudo nginx -t && sudo systemctl reload nginx
```

Now the app is reachable at `http://<your-ec2-public-ip>/`.

---

## Option B — AWS Elastic Beanstalk

Elastic Beanstalk can run this repo directly:

1. Install the EB CLI and run `eb init` (choose the **Node.js** platform).
2. `eb create maps-env`
3. In the environment configuration, set environment properties for
   `JWT_SECRET` and `NODE_ENV=production`.
4. Beanstalk runs `npm install` and `npm start` automatically (it reads the
   `start` script in `package.json`).

> **Note on the database:** SQLite stores data in a file on the instance's
> local disk, which is fine for a demo. If Beanstalk replaces the instance the
> file is lost. For a persistent multi-instance deployment you would move to a
> managed database (e.g. Amazon RDS) — out of scope for this project.

---

## Updating a running deployment

```bash
cd MAPS-System
git pull
npm install
sudo systemctl restart maps     # (EC2 + systemd)
```

The database file is preserved across restarts and updates. To wipe and reload
demo data, run `npm run reset-db`.

---

## Troubleshooting

| Symptom                              | Fix                                                        |
|--------------------------------------|------------------------------------------------------------|
| Can't reach the site                 | Check the EC2 **security group** allows the port           |
| `EADDRINUSE`                         | Another process uses the port — change `PORT` in `.env`    |
| `better-sqlite3` build error         | Ensure Node 18+ and a C toolchain (`sudo dnf groupinstall "Development Tools"`) |
| Logs                                 | `sudo journalctl -u maps -f` (systemd)                     |
