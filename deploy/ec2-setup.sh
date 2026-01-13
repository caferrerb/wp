#!/bin/bash
# ===========================================
# EC2 Setup Script for WhatsApp Receiver
# Using Node.js + PM2 (without Docker)
# ===========================================

set -e

echo "=========================================="
echo "WhatsApp Receiver - EC2 Setup (PM2)"
echo "=========================================="

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "Cannot detect OS"
    exit 1
fi

echo "Detected OS: $OS"

# Install Node.js 20.x
echo ""
echo "Installing Node.js 20.x..."
if [ "$OS" = "amzn" ]; then
    # Amazon Linux 2023
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
elif [ "$OS" = "ubuntu" ]; then
    # Ubuntu
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "Unsupported OS: $OS"
    exit 1
fi

echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Install PM2 globally
echo ""
echo "Installing PM2..."
sudo npm install -g pm2

# Setup PM2 to start on boot
echo ""
echo "Configuring PM2 startup..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME

# Create application directory
APP_DIR="$HOME/whatsapp-app"
echo ""
echo "Creating application directory: $APP_DIR"
mkdir -p $APP_DIR
mkdir -p $APP_DIR/logs
mkdir -p $APP_DIR/data
mkdir -p $APP_DIR/wa_session

# Create .env file template
if [ ! -f "$APP_DIR/.env" ]; then
    echo ""
    echo "Creating .env template..."
    cat > $APP_DIR/.env << 'ENVEOF'
# ===========================================
# WhatsApp Receiver - Environment Variables
# ===========================================

# Server
PORT=3000
NODE_ENV=production

# Paths (relative to app directory)
SESSION_PATH=./wa_session
DATA_PATH=./data

# Email Configuration (MailerSend)
EMAIL_PROVIDER=mailersend
MAILERSEND_API_KEY=mlsn.your_api_key_here
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=WhatsApp Receiver
EMAIL_REPORT_TO=your-email@example.com

# Daily Report
DAILY_REPORT_ENABLED=true
DAILY_REPORT_HOUR=8
DAILY_REPORT_MINUTE=0
EMAIL_FILTER_NUMBERS=573001234567,573009876543

# Timezone
TZ=America/Bogota
ENVEOF
    echo "Created .env template at $APP_DIR/.env"
    echo "IMPORTANT: Edit this file with your actual values!"
fi

# Create helper scripts
echo ""
echo "Creating helper scripts..."

# Deploy script
cat > $APP_DIR/deploy.sh << 'SCRIPTEOF'
#!/bin/bash
cd ~/whatsapp-app
pm2 reload whatsapp-receiver --update-env || pm2 start ecosystem.config.cjs
pm2 save
echo "Deploy complete!"
SCRIPTEOF
chmod +x $APP_DIR/deploy.sh

# Logs script
cat > $APP_DIR/logs.sh << 'SCRIPTEOF'
#!/bin/bash
pm2 logs whatsapp-receiver --lines 100
SCRIPTEOF
chmod +x $APP_DIR/logs.sh

# Status script
cat > $APP_DIR/status.sh << 'SCRIPTEOF'
#!/bin/bash
echo "=== PM2 Status ==="
pm2 status
echo ""
echo "=== App Info ==="
pm2 describe whatsapp-receiver
SCRIPTEOF
chmod +x $APP_DIR/status.sh

# Restart script
cat > $APP_DIR/restart.sh << 'SCRIPTEOF'
#!/bin/bash
cd ~/whatsapp-app
pm2 restart whatsapp-receiver
echo "Restart complete!"
SCRIPTEOF
chmod +x $APP_DIR/restart.sh

# Stop script
cat > $APP_DIR/stop.sh << 'SCRIPTEOF'
#!/bin/bash
pm2 stop whatsapp-receiver
echo "App stopped"
SCRIPTEOF
chmod +x $APP_DIR/stop.sh

# Backup script
cat > $APP_DIR/backup.sh << 'SCRIPTEOF'
#!/bin/bash
BACKUP_DIR=~/backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

echo "Creating backup..."
tar -czf $BACKUP_DIR/whatsapp_backup_$TIMESTAMP.tar.gz \
    -C ~/whatsapp-app \
    data wa_session .env

echo "Backup created: $BACKUP_DIR/whatsapp_backup_$TIMESTAMP.tar.gz"

# Keep only last 7 backups
cd $BACKUP_DIR && ls -t whatsapp_backup_*.tar.gz | tail -n +8 | xargs -r rm
echo "Old backups cleaned up"
SCRIPTEOF
chmod +x $APP_DIR/backup.sh

# Open firewall port 3000
echo ""
echo "Configuring firewall..."
if [ "$OS" = "amzn" ]; then
    # Amazon Linux - usually uses security groups, but check for firewalld
    if command -v firewall-cmd &> /dev/null; then
        sudo firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
        sudo firewall-cmd --reload 2>/dev/null || true
    fi
elif [ "$OS" = "ubuntu" ]; then
    # Ubuntu with ufw
    if command -v ufw &> /dev/null; then
        sudo ufw allow 3000/tcp 2>/dev/null || true
    fi
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Edit the .env file with your settings:"
echo "   nano $APP_DIR/.env"
echo ""
echo "2. The app will be deployed automatically via GitHub Actions"
echo "   Or deploy manually by copying files and running:"
echo "   cd $APP_DIR && npm ci --only=production && pm2 start ecosystem.config.cjs"
echo ""
echo "3. Open port 3000 in your EC2 Security Group"
echo ""
echo "Helper scripts available:"
echo "  ./deploy.sh   - Deploy/reload the app"
echo "  ./logs.sh     - View application logs"
echo "  ./status.sh   - Check app status"
echo "  ./restart.sh  - Restart the app"
echo "  ./stop.sh     - Stop the app"
echo "  ./backup.sh   - Backup data and session"
echo ""
