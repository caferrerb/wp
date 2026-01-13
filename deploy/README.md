# WhatsApp Receiver - Deployment Guide (PM2)

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [GitHub Secrets Configuration](#github-secrets-configuration)
4. [EC2 Initial Setup](#ec2-initial-setup)
5. [Environment Variables](#environment-variables)
6. [Deployment Workflows](#deployment-workflows)
7. [PM2 Commands](#pm2-commands)
8. [Troubleshooting](#troubleshooting)

---

## Overview

This application is a WhatsApp message receiver that:
- Receives and stores WhatsApp messages without marking them as read
- Provides a web interface to view and search messages
- Sends daily email reports with configurable phone number filters
- Persists the WhatsApp session across deployments (no need to re-scan QR)

### Deployment Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   GitHub    │────▶│   Build &    │────▶│    EC2      │
│   Push      │     │   Test       │     │  (PM2)      │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │   ESLint    │
                    │   TypeScript│
                    │   Build     │
                    └─────────────┘
```

---

## Architecture

### EC2 Server Structure

```
EC2 Instance
├── Node.js 20.x
├── PM2 (Process Manager)
└── ~/whatsapp-app/
    ├── dist/              # Compiled JavaScript
    │   └── public/        # Static web files
    ├── node_modules/      # Dependencies
    ├── data/              # SQLite database
    │   └── messages.db
    ├── wa_session/        # WhatsApp session (persists QR login)
    ├── logs/              # Application logs
    ├── .env               # Environment variables
    └── ecosystem.config.cjs  # PM2 configuration
```

---

## GitHub Secrets Configuration

Configure these secrets in your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description | Example |
|--------|-------------|---------|
| `EC2_HOST` | EC2 public IP or hostname | `54.123.45.67` |
| `EC2_USER` | SSH user for EC2 | `ec2-user` (Amazon Linux) or `ubuntu` |
| `EC2_SSH_KEY` | Private SSH key (full content) | `-----BEGIN RSA PRIVATE KEY-----...` |

### How to get the SSH key content:

```bash
# Copy your private key content
cat ~/.ssh/your-ec2-key.pem

# Copy everything including the BEGIN and END lines
```

---

## EC2 Initial Setup

### 1. Launch EC2 Instance

**Recommended Configuration:**
- **AMI**: Amazon Linux 2023 or Ubuntu 22.04 LTS
- **Instance Type**: t3.small (recommended) or t3.micro (minimum)
- **Storage**: 20GB+ EBS (gp3)
- **Security Group**:
  ```
  Inbound Rules:
  - SSH (22)      → Your IP
  - HTTP (3000)   → 0.0.0.0/0 (or your IP for security)
  ```

### 2. Connect and Run Setup Script

```bash
# Connect to EC2
ssh -i your-key.pem ec2-user@YOUR_EC2_IP

# Download setup script
curl -O https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/deploy/ec2-setup.sh

# Make executable and run
chmod +x ec2-setup.sh
./ec2-setup.sh
```

The setup script will:
- Install Node.js 20.x
- Install PM2 globally
- Configure PM2 to start on boot
- Create application directories
- Create helper scripts

### 3. Configure Environment Variables

```bash
cd ~/whatsapp-app

# Edit the .env file
nano .env

# Set your values (see Environment Variables section below)
```

### 4. First Deployment

The first deployment will be triggered automatically when you push to `main` branch.

### 5. Scan QR Code

1. Open in browser: `http://YOUR_EC2_IP:3000`
2. Scan the QR code with WhatsApp
3. Done! Future deployments won't require re-scanning.

---

## Environment Variables

Edit `~/whatsapp-app/.env` on EC2:

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `production` |

### Email Configuration (MailerSend)

| Variable | Description | Example |
|----------|-------------|---------|
| `EMAIL_PROVIDER` | Email service | `mailersend` |
| `MAILERSEND_API_KEY` | MailerSend API key | `mlsn.xxxxx` |
| `EMAIL_FROM` | Sender email (must use verified domain) | `noreply@your-domain.mlsender.net` |
| `EMAIL_FROM_NAME` | Sender display name | `WhatsApp Receiver` |
| `EMAIL_REPORT_TO` | Recipient for reports | `you@example.com` |

> **Important:** `EMAIL_FROM` must use a domain verified in MailerSend. For test accounts, use the provided `mlsender.net` subdomain (e.g., `noreply@test-xxxxx.mlsender.net`).

### Daily Report Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `DAILY_REPORT_ENABLED` | Enable daily emails | `true` or `false` |
| `DAILY_REPORT_HOUR` | Hour to send (0-23) | `8` |
| `DAILY_REPORT_MINUTE` | Minute to send (0-59) | `0` |
| `EMAIL_FILTER_NUMBERS` | Phone numbers to include | `573001234567,573009876543` |
| `TZ` | Timezone | `America/Bogota` |

### Example `.env` File

```env
# Server
PORT=3000
NODE_ENV=production

# Paths
SESSION_PATH=./wa_session
DATA_PATH=./data

# Email (MailerSend)
EMAIL_PROVIDER=mailersend
MAILERSEND_API_KEY=mlsn.your_api_key_here
EMAIL_FROM=noreply@your-domain.mlsender.net
EMAIL_FROM_NAME=WhatsApp Alerts
EMAIL_REPORT_TO=your-email@example.com

# Daily Report
DAILY_REPORT_ENABLED=true
DAILY_REPORT_HOUR=8
DAILY_REPORT_MINUTE=0
EMAIL_FILTER_NUMBERS=573001234567,573009876543

# Timezone
TZ=America/Bogota
```

---

## Deployment Workflows

### Automatic Deployment (CI/CD)

Every push to `main` branch triggers:

1. **Build & Test**: ESLint + TypeScript compilation
2. **Deploy to EC2**: Copies files and reloads PM2

### Manual Deployment (Promote)

To deploy a specific version (tag, branch, or commit):

1. Go to **Actions** → **Promote to Production**
2. Click **Run workflow**
3. Enter the git ref (e.g., `v1.0.0`, `main`, `abc1234`)
4. Type `deploy` to confirm
5. Click **Run workflow**

### Creating a Release

```bash
# Create and push a tag
git tag v1.0.0
git push origin v1.0.0
```

---

## PM2 Commands

### Helper Scripts (on EC2)

```bash
cd ~/whatsapp-app

./deploy.sh   # Reload the application
./logs.sh     # View application logs
./status.sh   # Check app status
./restart.sh  # Restart the app
./stop.sh     # Stop the app
./backup.sh   # Backup database and session
```

### Direct PM2 Commands

```bash
# View status
pm2 status

# View logs
pm2 logs whatsapp-receiver

# Restart
pm2 restart whatsapp-receiver

# Stop
pm2 stop whatsapp-receiver

# Start
pm2 start ecosystem.config.cjs

# Save current process list (survives reboot)
pm2 save

# Monitor resources
pm2 monit
```

---

## Troubleshooting

### Application Won't Start

```bash
# Check PM2 logs
pm2 logs whatsapp-receiver --lines 50

# Check if port is in use
sudo lsof -i :3000

# Try starting manually to see errors
cd ~/whatsapp-app
node dist/index.js
```

### Session Lost After Deployment

The WhatsApp session is stored in `~/whatsapp-app/wa_session/`. This directory is NOT overwritten during deployments, so sessions should persist.

If you need to reset:
```bash
cd ~/whatsapp-app
pm2 stop whatsapp-receiver
rm -rf wa_session/*
pm2 start whatsapp-receiver
# Then scan QR code at http://YOUR_IP:3000
```

### Port 3000 Not Accessible

1. Check EC2 Security Group allows inbound on port 3000
2. Check app is running: `pm2 status`
3. Check firewall: `sudo iptables -L`

### Email Not Sending

1. Check `MAILERSEND_API_KEY` is set correctly
2. Verify sender email is verified in MailerSend
3. Check logs: `pm2 logs whatsapp-receiver | grep -i email`

### Out of Memory

```bash
# Check memory usage
pm2 monit

# PM2 auto-restarts if memory exceeds 500MB (configured in ecosystem.config.cjs)
```

### View All Logs

```bash
# Application logs
cat ~/whatsapp-app/logs/out.log

# Error logs
cat ~/whatsapp-app/logs/error.log

# Or use PM2
pm2 logs whatsapp-receiver
```

---

## Files Reference

| File | Description |
|------|-------------|
| `ecosystem.config.cjs` | PM2 process configuration |
| `deploy/ec2-setup.sh` | EC2 initial setup script |
| `deploy/README.md` | This documentation |
| `.github/workflows/deploy.yml` | CI/CD pipeline |
| `.github/workflows/promote.yml` | Manual deployment workflow |

---

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review application logs: `pm2 logs whatsapp-receiver`
3. Open an issue on GitHub
