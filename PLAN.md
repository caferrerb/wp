# WhatsApp Message Receiver - Implementation Plan

## Overview

A Node.js/TypeScript application that receives WhatsApp messages without marking them as read, stores them in a database, and provides a web interface for viewing messages.

## Requirements Summary

1. **WhatsApp Integration**: Receive messages via `@whiskeysockets/baileys` - NEVER mark as read
2. **Database**: Store all received messages persistently
3. **Web Interface**: Read-only view of messages (no read marking)
4. **Single Application**: Web app and backend in the same application
5. **AWS EC2 Deployment**: Resilient process with systemd service
6. **Email Reports**: Endpoint to send CSV of messages via email + daily scheduled job
7. **Email Service**: Interface-based design with MailerSend implementation
8. **Configuration**: Environment variables with `.env.example`

## Technical Stack

- **Runtime**: Node.js v18+
- **Language**: TypeScript
- **Framework**: Express.js (API + static files)
- **Database**: SQLite (simple, file-based, no separate service needed)
- **WhatsApp Client**: @whiskeysockets/baileys
- **Email Service**: mailersend (via interface abstraction)
- **Process Manager**: systemd (for EC2)
- **Containerization**: Docker + docker-compose

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Express Server                          │
├─────────────┬─────────────────────────┬────────────────────┤
│  Static UI  │       REST API          │  WhatsApp Client   │
│  (HTML/JS)  │  /api/messages          │  (Baileys)         │
│             │  /api/export-csv        │                    │
│             │  /api/send-report       │                    │
└─────────────┴───────────┬─────────────┴────────────────────┘
                          │
              ┌───────────┴───────────┐
              │    Services Layer     │
              ├───────────────────────┤
              │  - MessageService     │
              │  - EmailService       │
              │  - ExportService      │
              │  - WhatsAppService    │
              └───────────┬───────────┘
                          │
              ┌───────────┴───────────┐
              │    Data Layer         │
              ├───────────────────────┤
              │  SQLite Database      │
              │  (messages.db)        │
              └───────────────────────┘
```

## Database Schema

### Messages Table
```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    remote_jid TEXT NOT NULL,          -- Sender phone/group ID
    sender_name TEXT,                   -- Sender display name
    message_id TEXT UNIQUE NOT NULL,    -- WhatsApp message ID
    message_type TEXT NOT NULL,         -- text, image, document, etc.
    content TEXT,                       -- Message content or caption
    timestamp INTEGER NOT NULL,         -- Unix timestamp
    is_group BOOLEAN DEFAULT FALSE,     -- Is from a group
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_remote_jid ON messages(remote_jid);
```

## Project Structure

```
wp/
├── src/
│   ├── index.ts                 # Application entry point
│   ├── config/
│   │   └── env.ts               # Environment configuration
│   ├── database/
│   │   ├── connection.ts        # SQLite connection
│   │   └── migrations.ts        # Database schema setup
│   ├── services/
│   │   ├── whatsapp.service.ts  # Baileys WhatsApp client
│   │   ├── message.service.ts   # Message CRUD operations
│   │   ├── export.service.ts    # CSV export functionality
│   │   └── email/
│   │       ├── email.interface.ts    # Email service interface
│   │       └── mailersend.impl.ts    # MailerSend implementation
│   ├── api/
│   │   ├── routes.ts            # API route definitions
│   │   └── controllers/
│   │       └── message.controller.ts
│   └── public/
│       ├── index.html           # Main UI
│       ├── styles.css           # Styles
│       └── app.js               # Frontend JavaScript
├── scripts/
│   └── install-service.sh       # EC2 systemd installation script
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Email Interface Design

```typescript
// email.interface.ts
interface EmailAttachment {
    filename: string;
    content: Buffer | string;  // Buffer or base64 string
}

interface SendEmailParams {
    to: string;           // Recipient email
    from: string;         // Sender email
    subject: string;
    body: string;         // HTML body
    attachment?: EmailAttachment;
}

interface IEmailService {
    sendEmail(params: SendEmailParams): Promise<void>;
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages` | Get all messages (paginated) |
| GET | `/api/messages?from=X&to=Y` | Get messages in date range |
| POST | `/api/send-report` | Send CSV report via email |
| GET | `/api/export-csv` | Download messages as CSV |
| GET | `/api/health` | Health check endpoint |
| GET | `/api/whatsapp/status` | Get WhatsApp connection status |
| GET | `/api/whatsapp/qr` | Get QR code for WhatsApp linking (returns base64 image) |

## WhatsApp QR Code Flow

1. When the application starts without a session, it generates a QR code
2. The web UI polls `/api/whatsapp/status` to check connection state
3. If not connected, the UI displays the QR from `/api/whatsapp/qr`
4. User scans QR with WhatsApp mobile app
5. Once connected, the status changes and QR is no longer needed
6. Session is persisted for future restarts

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=production

# WhatsApp
WA_SESSION_PATH=./wa_session

# Database
DATABASE_PATH=./data/messages.db

# Email (MailerSend)
MAILERSEND_API_KEY=your_api_key
EMAIL_FROM=reports@yourdomain.com
EMAIL_FROM_NAME=WhatsApp Reports
EMAIL_REPORT_TO=recipient@email.com

# Daily Report
ENABLE_DAILY_REPORT=true
DAILY_REPORT_HOUR=23
DAILY_REPORT_MINUTE=59
```

## Deployment (EC2)

### Systemd Service
The application will be installed as a systemd service for:
- Automatic startup on boot
- Automatic restart on crash
- Proper logging via journald
- Clean shutdown handling

### Installation Script
```bash
#!/bin/bash
# Creates systemd service, sets permissions, enables auto-start
```

## Implementation Phases

### Phase 1: Core Infrastructure
- [x] Project initialization
- [x] TypeScript configuration
- [x] Database setup (SQLite)
- [x] Environment configuration

### Phase 2: WhatsApp Integration
- [x] Baileys client setup
- [x] QR code authentication
- [x] Message listener (NO read marking)
- [x] Session persistence

### Phase 3: API & Services
- [x] Express server setup
- [x] Message service (CRUD)
- [x] REST endpoints

### Phase 4: Email Service
- [x] Email interface definition
- [x] MailerSend implementation
- [x] CSV export service
- [x] Report endpoint

### Phase 5: Web Interface
- [x] HTML/CSS UI
- [x] JavaScript frontend
- [x] Message list view
- [x] Pagination

### Phase 6: Deployment
- [x] Dockerfile
- [x] docker-compose.yml
- [x] EC2 systemd script
- [x] Documentation

## Security Considerations

1. **WhatsApp Session**: Store session files securely, not in version control
2. **API Keys**: Use environment variables, never hardcode
3. **Database**: Ensure proper file permissions on SQLite file
4. **No Read Marking**: Never call `readMessages()` in Baileys

## Daily Report Scheduler

Using `node-cron` to schedule the daily CSV export:
```typescript
cron.schedule('59 23 * * *', async () => {
    // Generate CSV for today's messages
    // Send via email
});
```
