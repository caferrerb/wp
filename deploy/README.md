# WhatsApp Receiver - Deployment Guide

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [GitHub Secrets Configuration](#github-secrets-configuration)
4. [EC2 Initial Setup](#ec2-initial-setup)
5. [Environment Variables](#environment-variables)
6. [Deployment Workflows](#deployment-workflows)
7. [Session Persistence](#session-persistence)
8. [Manual Operations](#manual-operations)
9. [Troubleshooting](#troubleshooting)

---

## Overview

This application is a WhatsApp message receiver that:
- Receives and stores WhatsApp messages without marking them as read
- Provides a web interface to view and search messages
- Sends daily email reports with configurable phone number filters
- Persists the WhatsApp session across deployments (no need to re-scan QR)

### Deployment Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│   GitHub    │────▶│   Build &    │────▶│  Docker Hub │────▶│    EC2      │
│   Push      │     │   Test       │     │   (Image)   │     │  (Deploy)   │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │   ESLint    │
                    │   TypeScript│
                    │   Build     │
                    └─────────────┘
```

---

## Architecture

### Docker Volumes (Session Persistence)

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Host (EC2)                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │            whatsapp-receiver container           │   │
│  │  ┌─────────────┐ ┌──────────┐ ┌──────────────┐  │   │
│  │  │ /app/wa_    │ │ /app/    │ │ /app/data/   │  │   │
│  │  │   session   │ │   data   │ │    media     │  │   │
│  │  └──────┬──────┘ └────┬─────┘ └──────┬───────┘  │   │
│  └─────────┼─────────────┼──────────────┼──────────┘   │
│            │             │              │               │
│  ┌─────────▼─────┐ ┌─────▼─────┐ ┌──────▼──────┐       │
│  │whatsapp_      │ │whatsapp_  │ │whatsapp_    │       │
│  │session        │ │data       │ │media        │       │
│  │(Named Volume) │ │(Named Vol)│ │(Named Vol)  │       │
│  └───────────────┘ └───────────┘ └─────────────┘       │
│         ▲                                               │
│         │                                               │
│   PERSISTS ACROSS DEPLOYMENTS                          │
│   (No need to re-scan QR code)                         │
└─────────────────────────────────────────────────────────┘
```

---

## GitHub Secrets Configuration

Configure these secrets in your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret | Description | Example |
|--------|-------------|---------|
| `DOCKER_USERNAME` | Docker Hub username | `myusername` |
| `DOCKER_PASSWORD` | Docker Hub password or access token | `dckr_pat_xxxxx` |
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
  - HTTPS (443)   → 0.0.0.0/0 (if using reverse proxy)
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

### 3. Log Out and Back In

```bash
# Required for Docker group permissions
exit

# Reconnect
ssh -i your-key.pem ec2-user@YOUR_EC2_IP
```

### 4. Configure Environment Variables

```bash
cd ~/whatsapp-app

# Edit the .env file
nano .env

# Set your values (see Environment Variables section below)
```

### 5. First Deployment

The first deployment will be triggered automatically when you push to `main` branch.

Or deploy manually:

```bash
cd ~/whatsapp-app

# Set your Docker image (replace with your Docker Hub username)
export DOCKER_IMAGE=yourusername/whatsapp-receiver
export IMAGE_TAG=latest

# Pull and start
docker-compose pull
docker-compose up -d

# Check logs
docker-compose logs -f
```

### 6. Scan QR Code

1. Open in browser: `http://YOUR_EC2_IP:3000`
2. Scan the QR code with WhatsApp
3. Done! Future deployments won't require re-scanning.

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
nano .env
```

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DOCKER_IMAGE` | Docker Hub image name | `myuser/whatsapp-receiver` |
| `IMAGE_TAG` | Image tag to deploy | `latest` or `v1.0.0` |

### Email Configuration (Optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `EMAIL_PROVIDER` | Email service | `mailersend` |
| `MAILERSEND_API_KEY` | MailerSend API key | `mlsn.xxxxx` |
| `EMAIL_FROM` | Sender email (verified) | `noreply@yourdomain.com` |
| `EMAIL_FROM_NAME` | Sender display name | `WhatsApp Receiver` |
| `EMAIL_REPORT_TO` | Recipient for reports | `you@example.com` |

### Daily Report Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `DAILY_REPORT_ENABLED` | Enable daily emails | `true` or `false` |
| `DAILY_REPORT_HOUR` | Hour to send (0-23) | `8` |
| `DAILY_REPORT_MINUTE` | Minute to send (0-59) | `0` |
| `EMAIL_FILTER_NUMBERS` | Phone numbers to include | `573001234567,573009876543` |
| `TZ` | Timezone for cron | `America/Bogota` |

### Example `.env` File

```env
# Docker
DOCKER_IMAGE=myuser/whatsapp-receiver
IMAGE_TAG=latest
APP_PORT=3000

# Email
EMAIL_PROVIDER=mailersend
MAILERSEND_API_KEY=mlsn.your_api_key_here
EMAIL_FROM=noreply@mycompany.com
EMAIL_FROM_NAME=WhatsApp Alerts
EMAIL_REPORT_TO=team@mycompany.com

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
2. **Docker Build**: Creates image with tags `latest` and `sha-xxxxx`
3. **Deploy to EC2**: Pulls and restarts container

### Manual Deployment (Promote)

To deploy a specific version:

1. Go to **Actions** → **Promote to Production**
2. Click **Run workflow**
3. Enter the image tag (e.g., `v1.0.0`, `sha-abc1234`, `latest`)
4. Type `deploy` to confirm
5. Click **Run workflow**

### Creating a Release

To create a versioned release:

```bash
# Create and push a tag
git tag v1.0.0
git push origin v1.0.0
```

This creates a Docker image with tags: `v1.0.0`, `1.0`, and `latest`

---

## Session Persistence

### Why It Matters

The WhatsApp session is stored in `/app/wa_session` inside the container. Without persistence, you would need to scan the QR code after every deployment.

### How It Works

We use Docker **named volumes** that persist independently of containers:

```yaml
volumes:
  wa_session:
    name: whatsapp_session  # Persists across deployments
```

### Safe Operations (Session Preserved)

✅ `docker-compose down` - Stops container, keeps volumes
✅ `docker-compose up -d` - Starts container, uses existing volumes
✅ `docker-compose pull` - Updates image, keeps volumes
✅ Image updates - Volume data persists

### Dangerous Operations (Session Lost)

❌ `docker-compose down -v` - Deletes volumes!
❌ `docker volume rm whatsapp_session` - Deletes session!
❌ `docker system prune -a --volumes` - Deletes everything!

---

## Manual Operations

### Helper Scripts

After setup, these scripts are available in `~/whatsapp-app/`:

```bash
./deploy.sh   # Pull and restart with latest image
./logs.sh     # View application logs
./status.sh   # Check container and volume status
./backup.sh   # Backup database and session
```

### View Logs

```bash
cd ~/whatsapp-app
docker-compose logs -f --tail=100
```

### Restart Container

```bash
cd ~/whatsapp-app
docker-compose restart
```

### Update to Latest

```bash
cd ~/whatsapp-app
docker-compose pull
docker-compose down
docker-compose up -d
```

### Deploy Specific Version

```bash
cd ~/whatsapp-app
export IMAGE_TAG=v1.0.0
docker-compose pull
docker-compose down
docker-compose up -d
```

### Backup Data

```bash
cd ~/whatsapp-app
./backup.sh
```

### Reset Session (Requires QR Scan)

```bash
cd ~/whatsapp-app
docker-compose down
docker volume rm whatsapp_session
docker-compose up -d
# Then scan QR code at http://YOUR_IP:3000
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs for errors
docker-compose logs --tail=50

# Check container status
docker-compose ps
```

### Session Lost After Deployment

```bash
# Check if volumes exist
docker volume ls | grep whatsapp

# Should show:
# whatsapp_session
# whatsapp_data
# whatsapp_media
```

If volumes are missing, the session was deleted. You'll need to scan QR again.

### Port 3000 Not Accessible

1. Check EC2 Security Group allows inbound on port 3000
2. Check container is running: `docker-compose ps`
3. Check no firewall blocking: `sudo iptables -L`

### Docker Permission Denied

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in
exit
# Reconnect via SSH
```

### Email Not Sending

1. Check `MAILERSEND_API_KEY` is set correctly
2. Verify sender email is verified in MailerSend
3. Check logs: `docker-compose logs | grep -i email`

### Daily Report Not Working

1. Check `DAILY_REPORT_ENABLED=true`
2. Check `EMAIL_REPORT_TO` is set
3. Verify timezone: `TZ=America/Bogota`
4. Check logs at the scheduled time

---

## Files in This Directory

| File | Description |
|------|-------------|
| `docker-compose.yml` | Production Docker Compose configuration |
| `.env.example` | Example environment variables |
| `ec2-setup.sh` | EC2 initial setup script |
| `README.md` | This documentation |

---

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review application logs: `docker-compose logs`
3. Open an issue on GitHub
