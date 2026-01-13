# WhatsApp Message Receiver

## Project Overview
A WhatsApp message receiver application using @whiskeysockets/baileys that:
- Receives and stores WhatsApp messages in SQLite without marking them as read
- Provides a web interface to view and search messages
- Sends daily email reports with configurable phone number filters
- Supports WhatsApp commands for remote control
- Persists WhatsApp session across restarts

## Tech Stack
- **Runtime**: Node.js 20 + TypeScript
- **WhatsApp**: @whiskeysockets/baileys
- **Database**: SQLite (better-sqlite3)
- **Email**: MailerSend (production) / Mailpit (development)
- **Process Manager**: PM2 (production) / Docker Compose (local dev)
- **CI/CD**: GitHub Actions

## Project Structure
```
src/
├── index.ts              # Application entry point
├── config/
│   └── env.ts            # Environment configuration
├── services/
│   ├── whatsapp.service.ts   # WhatsApp connection & message handling
│   ├── message.service.ts    # SQLite message storage
│   ├── command.service.ts    # WhatsApp command interface
│   ├── export.service.ts     # CSV export functionality
│   ├── scheduler.service.ts  # Daily report scheduler
│   └── email/
│       ├── email.interface.ts
│       ├── mailersend.impl.ts
│       └── mailpit.impl.ts
└── public/               # Web interface (search page)

deploy/
├── ec2-setup.sh          # EC2 initial setup script
├── README.md             # Deployment documentation
└── .env.example          # Environment template
```

## Key Configuration (.env)
```env
# Email Provider: 'mailersend' or 'mailpit'
EMAIL_PROVIDER=mailersend
MAILERSEND_API_KEY=mlsn.xxx
EMAIL_FROM=noreply@your-domain.mlsender.net
EMAIL_REPORT_TO=your-email@example.com

# Daily Report
DAILY_REPORT_ENABLED=true
DAILY_REPORT_HOUR=8
EMAIL_FILTER_NUMBERS=573001234567,573009876543

# WhatsApp Commands - authorized phone numbers
COMMAND_NUMBERS=573001234567

# Timezone
TZ=America/Bogota
```

## WhatsApp Commands
Send these from an authorized number (COMMAND_NUMBERS):
- `help` / `ayuda` - Show available commands
- `state` / `status` / `estado` - Send health check email
- `csv` / `mail-csv` - Send CSV with messages from supervised contacts
- `qr` - Reset session and send QR code by email

## Important Implementation Details

### Message Timestamp Handling
The `messageTimestamp` from Baileys can be a Long object. Handle it like:
```typescript
if (typeof msg.messageTimestamp === 'object' && 'toNumber' in msg.messageTimestamp) {
  timestamp = msg.messageTimestamp.toNumber();
}
```

### Command Execution Safety
Commands only execute for messages less than 60 seconds old to prevent execution when syncing history:
```typescript
const messageAgeSeconds = Math.floor(Date.now() / 1000) - timestamp;
const isRecentMessage = messageAgeSeconds < 60;
```

### History Sync
`syncFullHistory: false` in makeWASocket to only sync recent messages.

### Session Persistence
WhatsApp session stored in `wa_session/` directory. Persists across restarts.

## Local Development
```bash
# Start with Docker Compose
docker-compose up -d --build

# View logs
docker logs whatsapp-message-receiver -f

# Clear session (new QR)
rm -rf wa_session/* && docker restart whatsapp-message-receiver
```

## Deployment (EC2 + PM2)
See `deploy/README.md` for full documentation.

GitHub Secrets required:
- `EC2_HOST` - EC2 public IP
- `EC2_USER` - SSH user (ec2-user or ubuntu)
- `EC2_SSH_KEY` - Private SSH key content

## Common Issues

### Commands not executing
- Check COMMAND_NUMBERS includes the sender's number
- Messages older than 60 seconds are ignored
- Check logs: `docker logs whatsapp-message-receiver | grep CMD`

### Email not sending
- Verify EMAIL_PROVIDER and MAILERSEND_API_KEY
- EMAIL_FROM must use a verified MailerSend domain
- Check logs for email errors

### Session lost
- Session persists in `wa_session/` directory
- Clear it only if you need a new QR code
