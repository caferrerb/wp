#!/bin/bash
# ===========================================
# EC2 Initial Setup Script for WhatsApp Receiver
# ===========================================
# Run this script once on a fresh EC2 instance
# Supports: Amazon Linux 2023, Ubuntu 22.04+
# ===========================================

set -e

echo "==========================================="
echo "  WhatsApp Receiver - EC2 Setup"
echo "==========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo -e "${RED}Cannot detect OS${NC}"
    exit 1
fi

echo -e "${GREEN}Detected OS: $OS${NC}"

# Install Docker
echo ""
echo -e "${YELLOW}[1/5] Installing Docker...${NC}"
if [ "$OS" = "amzn" ] || [ "$OS" = "amazon" ]; then
    # Amazon Linux
    sudo yum update -y
    sudo yum install -y docker git
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER
elif [ "$OS" = "ubuntu" ]; then
    # Ubuntu
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg git
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo usermod -aG docker $USER
else
    echo -e "${RED}Unsupported OS: $OS${NC}"
    exit 1
fi

# Install Docker Compose standalone
echo ""
echo -e "${YELLOW}[2/5] Installing Docker Compose...${NC}"
DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep -oP '"tag_name": "\K(.*)(?=")')
sudo curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
echo -e "${GREEN}Docker Compose version: ${DOCKER_COMPOSE_VERSION}${NC}"

# Create application directory
APP_DIR="/home/$USER/whatsapp-app"
echo ""
echo -e "${YELLOW}[3/5] Creating application directory: ${APP_DIR}${NC}"
mkdir -p $APP_DIR
cd $APP_DIR

# Create .env file from example
echo ""
echo -e "${YELLOW}[4/5] Creating configuration files...${NC}"
if [ ! -f .env ]; then
    cat > .env << 'ENVEOF'
# WhatsApp Receiver Configuration
# Edit these values before starting the application

# Docker Image
DOCKER_IMAGE=your-dockerhub-username/whatsapp-receiver
IMAGE_TAG=latest

# Application
APP_PORT=3000

# Email (optional - for daily reports)
EMAIL_PROVIDER=mailersend
MAILERSEND_API_KEY=
EMAIL_FROM=
EMAIL_FROM_NAME=WhatsApp Receiver
EMAIL_REPORT_TO=

# Daily Report
DAILY_REPORT_ENABLED=false
DAILY_REPORT_HOUR=8
DAILY_REPORT_MINUTE=0
EMAIL_FILTER_NUMBERS=

# Timezone
TZ=America/Bogota
ENVEOF
    echo -e "${GREEN}Created .env file${NC}"
else
    echo -e "${YELLOW}.env file already exists, skipping${NC}"
fi

# Create deployment script
echo ""
echo -e "${YELLOW}[5/5] Creating helper scripts...${NC}"

cat > deploy.sh << 'DEPLOYEOF'
#!/bin/bash
# Quick deployment script
set -e

echo "Pulling latest image..."
docker-compose pull

echo "Restarting container..."
docker-compose down --remove-orphans
docker-compose up -d

echo "Cleaning up old images..."
docker image prune -f

echo "Status:"
docker-compose ps
DEPLOYEOF
chmod +x deploy.sh

cat > logs.sh << 'LOGSEOF'
#!/bin/bash
# View application logs
docker-compose logs -f --tail=100
LOGSEOF
chmod +x logs.sh

cat > status.sh << 'STATUSEOF'
#!/bin/bash
# Check application status
echo "=== Container Status ==="
docker-compose ps
echo ""
echo "=== Docker Volumes ==="
docker volume ls | grep whatsapp
echo ""
echo "=== Recent Logs ==="
docker-compose logs --tail=20
STATUSEOF
chmod +x status.sh

cat > backup.sh << 'BACKUPEOF'
#!/bin/bash
# Backup data and session
BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

echo "Backing up database..."
docker cp whatsapp-receiver:/app/data/messages.db $BACKUP_DIR/

echo "Backing up session..."
docker run --rm -v whatsapp_session:/data -v $(pwd)/$BACKUP_DIR:/backup alpine tar czf /backup/session.tar.gz -C /data .

echo "Backup completed: $BACKUP_DIR"
ls -la $BACKUP_DIR
BACKUPEOF
chmod +x backup.sh

# Final instructions
echo ""
echo "==========================================="
echo -e "${GREEN}  Setup Complete!${NC}"
echo "==========================================="
echo ""
echo -e "${YELLOW}IMPORTANT: Log out and log back in for Docker permissions to take effect${NC}"
echo ""
echo "Next steps:"
echo ""
echo "  1. Log out and log back in:"
echo "     ${GREEN}exit${NC}"
echo ""
echo "  2. Edit the configuration file:"
echo "     ${GREEN}cd $APP_DIR && nano .env${NC}"
echo ""
echo "  3. Copy docker-compose.yml to this directory"
echo "     (This will be done automatically by GitHub Actions)"
echo ""
echo "  4. Start the application:"
echo "     ${GREEN}./deploy.sh${NC}"
echo ""
echo "  5. Open in browser and scan QR code:"
echo "     ${GREEN}http://YOUR_EC2_IP:3000${NC}"
echo ""
echo "Helper scripts created:"
echo "  - ./deploy.sh  - Deploy/update the application"
echo "  - ./logs.sh    - View application logs"
echo "  - ./status.sh  - Check application status"
echo "  - ./backup.sh  - Backup data and session"
echo ""
echo "==========================================="
echo ""
