import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  getContentType,
  Browsers,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import { config } from '../config/env.js';
import { MessageService, CreateMessageParams } from './message.service.js';
import fs from 'fs';
import path from 'path';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'qr_ready';

// Simple logger compatible with Baileys ILogger interface
const logger = {
  level: 'silent',
  info: () => {},
  error: (...args: unknown[]) => console.error('[WA]', ...args),
  warn: () => {},
  debug: () => {},
  trace: () => {},
  fatal: (...args: unknown[]) => console.error('[WA FATAL]', ...args),
  child: () => logger,
};

export class WhatsAppService {
  private socket: WASocket | null = null;
  private qrCode: string | null = null;
  private status: ConnectionStatus = 'disconnected';
  private messageService: MessageService;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private mediaPath: string;

  constructor(messageService: MessageService) {
    this.messageService = messageService;
    this.mediaPath = path.join(process.cwd(), 'data', 'media');

    // Ensure media directory exists
    if (!fs.existsSync(this.mediaPath)) {
      fs.mkdirSync(this.mediaPath, { recursive: true });
    }
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getQrCode(): string | null {
    return this.qrCode;
  }

  async getQrCodeDataUrl(): Promise<string | null> {
    if (!this.qrCode) return null;
    try {
      return await QRCode.toDataURL(this.qrCode);
    } catch {
      return null;
    }
  }

  async initialize(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const sessionPath = config.whatsapp.sessionPath;

    // Ensure session directory exists
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    this.status = 'connecting';

    this.socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger as any),
      },
      logger: logger as any,
      browser: Browsers.macOS('Chrome'),
      syncFullHistory: true,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      // getMessage is required for message retries
      getMessage: async (_key) => {
        // Return undefined - we don't store messages for retry
        return undefined;
      },
    });

    // Handle connection updates
    this.socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrCode = qr;
        this.status = 'qr_ready';
        console.log('QR Code ready for scanning');
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log(
          'Connection closed due to:',
          (lastDisconnect?.error as Boom)?.output?.payload?.message || 'Unknown reason'
        );

        this.status = 'disconnected';
        this.qrCode = null;

        if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          setTimeout(() => this.connect(), 5000);
        } else if (!shouldReconnect) {
          console.log('Logged out. Please delete the session folder and restart.');
        }
      } else if (connection === 'open') {
        this.status = 'connected';
        this.qrCode = null;
        this.reconnectAttempts = 0;
        console.log('WhatsApp connected successfully');
      }
    });

    // Save credentials when updated
    this.socket.ev.on('creds.update', saveCreds);

    // Handle history sync - this is where old messages come from
    this.socket.ev.on('messaging-history.set', async ({ messages: historyMessages, chats, isLatest }) => {
      console.log(`[WA] History sync received: ${historyMessages.length} messages, ${chats.length} chats, isLatest=${isLatest}`);

      for (const msg of historyMessages) {
        if (!msg.key || !msg.message) continue;

        const contentType = getContentType(msg.message);
        if (!contentType ||
            contentType === 'protocolMessage' ||
            contentType === 'reactionMessage' ||
            contentType === 'senderKeyDistributionMessage') {
          continue;
        }

        await this.processMessage(msg);
      }
    });

    // Handle incoming messages - NEVER mark as read
    this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log(`[WA] messages.upsert: type=${type}, count=${messages.length}`);

      // Process both 'notify' (new messages) and 'append' (sync/history)
      if (type !== 'notify' && type !== 'append') return;

      for (const msg of messages) {
        if (!msg.key) {
          continue;
        }
        if (!msg.message) {
          continue;
        }

        // Get message content type
        const contentType = getContentType(msg.message);
        const msgKeys = Object.keys(msg.message).filter(k => !k.startsWith('_'));
        console.log(`[WA] Processing message: contentType=${contentType}, keys=${msgKeys.join(',')}, from=${msg.key.remoteJid}`);

        // Skip reactions and sender key distribution (but log protocol messages for debugging)
        if (!contentType ||
            contentType === 'reactionMessage' ||
            contentType === 'senderKeyDistributionMessage' ||
            contentType === 'messageContextInfo') {
          console.log(`[WA] Skipping: filtered contentType=${contentType}`);
          continue;
        }

        // For protocol messages, check if there's actual content inside
        if (contentType === 'protocolMessage') {
          const protoMsg = msg.message.protocolMessage;
          console.log(`[WA] Protocol message type: ${protoMsg?.type}, keys: ${protoMsg ? Object.keys(protoMsg).join(',') : 'none'}`);
          // Skip protocol messages - they're just sync/read receipts/etc
          continue;
        }

        await this.processMessage(msg);
      }
    });
  }

  private async processMessage(msg: proto.IWebMessageInfo): Promise<void> {
    if (!msg.key || !msg.message) return;

    const remoteJid = msg.key.remoteJid || '';
    const isGroup = remoteJid.endsWith('@g.us');

    // Handle messageTimestamp which can be number, Long object, or undefined
    let timestamp: number;
    if (msg.messageTimestamp) {
      // If it's a Long object, it has toNumber() method
      if (typeof msg.messageTimestamp === 'object' && 'toNumber' in msg.messageTimestamp) {
        timestamp = (msg.messageTimestamp as { toNumber: () => number }).toNumber();
      } else if (typeof msg.messageTimestamp === 'number') {
        timestamp = msg.messageTimestamp;
      } else {
        // Try to convert to number
        timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);
      }
    } else {
      timestamp = Math.floor(Date.now() / 1000);
    }

    // Get sender name
    let senderName = msg.pushName || '';
    if (isGroup && msg.key.participant) {
      senderName = msg.pushName || msg.key.participant;
    }

    // Extract message content
    const extracted = await this.extractAndDownloadContent(msg);

    // Skip if extraction failed or message type should be ignored
    if (!extracted || extracted.type === 'skip') {
      return;
    }

    const messageParams: CreateMessageParams = {
      remote_jid: remoteJid,
      sender_name: senderName,
      message_id: msg.key.id || `${Date.now()}`,
      message_type: extracted.type,
      content: extracted.content,
      timestamp: timestamp,
      is_group: isGroup,
      is_from_me: msg.key.fromMe || false,
      media_path: extracted.mediaPath,
      media_mimetype: extracted.mimetype,
    };

    const savedMessage = this.messageService.createMessage(messageParams);
    if (savedMessage) {
      console.log(`Message saved: [${extracted.type}] from ${senderName || remoteJid}`);
    }
  }

  private async extractAndDownloadContent(msg: proto.IWebMessageInfo): Promise<{
    content: string;
    type: string;
    mediaPath?: string;
    mimetype?: string;
  } | null> {
    const message = this.unwrapMessage(msg.message!);
    if (!message) return null;

    // Text messages
    if (message.conversation) {
      return { content: message.conversation, type: 'text' };
    }

    if (message.extendedTextMessage?.text) {
      return { content: message.extendedTextMessage.text, type: 'text' };
    }

    // Image message
    if (message.imageMessage) {
      const media = await this.downloadMedia(msg, 'image', message.imageMessage.mimetype || 'image/jpeg');
      return {
        content: message.imageMessage.caption || '[Image]',
        type: 'image',
        mediaPath: media?.path,
        mimetype: message.imageMessage.mimetype || undefined,
      };
    }

    // Video message
    if (message.videoMessage) {
      const media = await this.downloadMedia(msg, 'video', message.videoMessage.mimetype || 'video/mp4');
      return {
        content: message.videoMessage.caption || '[Video]',
        type: 'video',
        mediaPath: media?.path,
        mimetype: message.videoMessage.mimetype || undefined,
      };
    }

    // Audio/Voice message
    if (message.audioMessage) {
      const isPtt = message.audioMessage.ptt;
      const media = await this.downloadMedia(msg, isPtt ? 'voice' : 'audio', message.audioMessage.mimetype || 'audio/ogg');
      return {
        content: isPtt ? '[Voice note]' : '[Audio]',
        type: isPtt ? 'voice' : 'audio',
        mediaPath: media?.path,
        mimetype: message.audioMessage.mimetype || undefined,
      };
    }

    // Document message
    if (message.documentMessage) {
      const media = await this.downloadMedia(msg, 'document', message.documentMessage.mimetype || 'application/octet-stream');
      return {
        content: message.documentMessage.fileName || '[Document]',
        type: 'document',
        mediaPath: media?.path,
        mimetype: message.documentMessage.mimetype || undefined,
      };
    }

    // Sticker message
    if (message.stickerMessage) {
      const media = await this.downloadMedia(msg, 'sticker', message.stickerMessage.mimetype || 'image/webp');
      return {
        content: '[Sticker]',
        type: 'sticker',
        mediaPath: media?.path,
        mimetype: message.stickerMessage.mimetype || undefined,
      };
    }

    // Contact message
    if (message.contactMessage) {
      return {
        content: message.contactMessage.displayName || '[Contact]',
        type: 'contact',
      };
    }

    // Contact array message
    if (message.contactsArrayMessage) {
      const count = message.contactsArrayMessage.contacts?.length || 0;
      return { content: `[${count} Contacts]`, type: 'contacts' };
    }

    // Location message
    if (message.locationMessage) {
      const lat = message.locationMessage.degreesLatitude;
      const lon = message.locationMessage.degreesLongitude;
      return { content: `Location: ${lat}, ${lon}`, type: 'location' };
    }

    // Live location message
    if (message.liveLocationMessage) {
      return { content: '[Live Location]', type: 'live_location' };
    }

    // Poll message
    if (message.pollCreationMessage) {
      return { content: message.pollCreationMessage.name || '[Poll]', type: 'poll' };
    }

    // Button response
    if (message.buttonsResponseMessage) {
      return {
        content: message.buttonsResponseMessage.selectedDisplayText || '[Button response]',
        type: 'button_response',
      };
    }

    // List response
    if (message.listResponseMessage) {
      return {
        content: message.listResponseMessage.title || '[List response]',
        type: 'list_response',
      };
    }

    // Skip message context info wrapper (it often wraps other content)
    if (message.messageContextInfo) {
      // This is just metadata, skip it
      return { type: 'skip', content: '' };
    }

    // Log unknown types for debugging
    const keys = Object.keys(message).filter(k => !k.startsWith('_') && k !== 'messageContextInfo');
    if (keys.length === 0) {
      return { type: 'skip', content: '' };
    }
    console.log('[WA] Unhandled message type, keys:', keys);

    return { content: '[Unsupported message]', type: 'unknown' };
  }

  private unwrapMessage(message: proto.IMessage): proto.IMessage | null {
    // Unwrap nested message types
    if (message.viewOnceMessage?.message) {
      return this.unwrapMessage(message.viewOnceMessage.message);
    }
    if (message.viewOnceMessageV2?.message) {
      return this.unwrapMessage(message.viewOnceMessageV2.message);
    }
    if (message.viewOnceMessageV2Extension?.message) {
      return this.unwrapMessage(message.viewOnceMessageV2Extension.message);
    }
    if (message.ephemeralMessage?.message) {
      return this.unwrapMessage(message.ephemeralMessage.message);
    }
    if (message.documentWithCaptionMessage?.message) {
      return this.unwrapMessage(message.documentWithCaptionMessage.message);
    }
    return message;
  }

  private async downloadMedia(
    msg: proto.IWebMessageInfo,
    type: string,
    mimetype: string
  ): Promise<{ path: string } | null> {
    try {
      const buffer = await downloadMediaMessage(
        msg as any,
        'buffer',
        {},
        {
          logger: logger as any,
          reuploadRequest: this.socket!.updateMediaMessage,
        }
      );

      if (!buffer) {
        console.log('[WA] Failed to download media: no buffer');
        return null;
      }

      // Generate filename
      const ext = this.getExtensionFromMimetype(mimetype);
      const filename = `${type}_${msg.key?.id || Date.now()}${ext}`;
      const filePath = path.join(this.mediaPath, filename);

      // Save file
      fs.writeFileSync(filePath, buffer);
      console.log(`[WA] Media saved: ${filename}`);

      // Return relative path for web access
      return { path: `/media/${filename}` };
    } catch (error) {
      console.error('[WA] Error downloading media:', error);
      return null;
    }
  }

  private getExtensionFromMimetype(mimetype: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/3gpp': '.3gp',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    };
    return map[mimetype] || '.bin';
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
      this.status = 'disconnected';
      this.qrCode = null;
    }
  }

  async resetSession(): Promise<void> {
    console.log('[WA] Resetting session...');

    // Close existing connection
    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch {
        // Ignore errors during disconnect
      }
      this.socket = null;
    }

    this.status = 'disconnected';
    this.qrCode = null;
    this.reconnectAttempts = 0;

    // Clear session files
    const sessionPath = config.whatsapp.sessionPath;
    if (fs.existsSync(sessionPath)) {
      const files = fs.readdirSync(sessionPath);
      for (const file of files) {
        fs.unlinkSync(path.join(sessionPath, file));
      }
      console.log('[WA] Session files cleared');
    }

    // Reconnect to get new QR
    await this.connect();
  }
}
