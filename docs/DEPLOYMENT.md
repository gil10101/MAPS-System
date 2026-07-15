# Deployment Guide

MAPS is a single Node.js process that serves both the REST API and the built
React frontend. Data lives in a **PostgreSQL** database (we use a free
[Neon](https://neon.tech) instance), so the app server itself is stateless —
it can restart or redeploy without losing any data. Below: free hosting
options, then a step-by-step **AWS EC2** guide.

---

## Environment variables

Configure these in a `.env` file (copy `.env.example`) or as real environment
variables on the host:

| Variable         | Default              | Notes                                              |
|------------------|----------------------|----------------------------------------------------|
| `DATABASE_URL`   | (required)           | Postgres connection string (Neon dashboard)        |
| `PORT`           | `3000`               | Port the server listens on                         |
| `JWT_SECRET`     | (dev fallback)       | **Set a long random string in production**         |
| `JWT_EXPIRES_IN` | `7d`                 | Token lifetime                                     |
| `NODE_ENV`       | `development`        | Set to `production` on a server                    |

Generate a strong secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Database — Neon (free Postgres)

1. Sign up at [neon.tech](https://neon.tech) (free tier, no credit card).
2. Create a project; copy the connection string
   (`postgres://USER:PASS@ep-xxx.aws.neon.tech/neondb?sslmode=require`).
3. Use it as `DATABASE_URL` everywhere (local dev, Render, EC2). The schema is
   created automatically on first start; `npm run seed` loads demo data.

Because the database is hosted, every deployment option below is stateless —
appointments booked during a demo survive restarts and redeploys.

---

## Free hosting options (no AWS bill)

AWS EC2 is only free for the first 12 months of a new account. If that's not an
option:

| Host | Free? | Notes |
|------|-------|-------|
| **Render.com** | Yes | Easiest. This repo ships a `render.yaml` — on Render, choose **New → Blueprint** and point it at the repo. Sleeps after ~15 min idle (~30s cold start). |
| **Fly.io** | Free allowance | Also works well; needs a `Dockerfile` / `fly.toml`. |
| **Railway** | $5/mo trial credit | Easy, but not unlimited-free. |
| **Localhost** | Free | `npm run build && npm start` on a laptop is perfectly fine for a class presentation (the DB is on Neon either way). |

### Deploy to Render (recommended free option)

1. Push this repo to GitHub.
2. Go to [render.com](https://render.com) → **New → Blueprint** → connect the repo.
3. Render reads `render.yaml`: it builds the React client (`npm run build`),
   then runs `npm run seed && npm start`.
4. When prompted, paste your **Neon connection string** as `DATABASE_URL`.
5. Open the generated `*.onrender.com` URL. Demo logins from the README work.

---

## Option A — AWS EC2 (12-month free tier)

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
# Edit .env: set DATABASE_URL (Neon), NODE_ENV=production, a real JWT_SECRET
npm run seed        # load demo data for the presentation
npm run build       # build the React frontend
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
   `DATABASE_URL` (Neon), `JWT_SECRET`, and `NODE_ENV=production`.
4. Beanstalk runs `npm install` and `npm start` automatically. Add a
   `predeploy` step or run `npm run build` in CI so `client/dist` exists.

> The database is hosted on Neon, so instance replacement never loses data.

---

## Updating a running deployment

```bash
cd MAPS-System
git pull
npm install
npm run build                   # rebuild the frontend
sudo systemctl restart maps     # (EC2 + systemd)
```

Data lives in Postgres and is preserved across restarts and updates. To wipe
and reload demo data, run `npm run reset-db`.

---

## Troubleshooting

| Symptom                              | Fix                                                        |
|--------------------------------------|------------------------------------------------------------|
| Can't reach the site                 | Check the EC2 **security group** allows the port           |
| `EADDRINUSE`                         | Another process uses the port — change `PORT` in `.env`    |
| "Failed to initialize the database"  | Check `DATABASE_URL` — copy it fresh from the Neon dashboard (must include `?sslmode=require`) |
| "Frontend not built yet" page        | Run `npm run build` to produce `client/dist`               |
| Logs                                 | `sudo journalctl -u maps -f` (systemd)                     |
