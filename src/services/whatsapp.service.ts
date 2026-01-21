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
import { CommandService } from './command.service.js';
import { errorService } from './error.service.js';
import { eventService } from './event.service.js';
import { groupService } from './group.service.js';
import fs from 'fs';
import path from 'path';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'qr_ready';

// Simple logger compatible with Baileys ILogger interface
const logger = {
  level: 'silent',
  info: () => {},
  error: (...args: unknown[]) => {
    console.error('[WA]', ...args);
    // Log to database
    const errorObj = args[0];
    if (errorObj && typeof errorObj === 'object') {
      const err = errorObj as Record<string, unknown>;
      errorService.logError({
        error_type: 'WhatsAppError',
        error_message: err.error instanceof Error ? err.error.message : String(err.error || 'Unknown error'),
        error_stack: err.error instanceof Error ? err.error.stack : undefined,
        location: 'whatsapp.service.ts:logger',
        context: JSON.stringify({
          key: err.key,
          messageType: err.messageType,
          sender: err.sender,
          author: err.author,
        }),
      });
    }
  },
  warn: () => {},
  debug: () => {},
  trace: () => {},
  fatal: (...args: unknown[]) => {
    console.error('[WA FATAL]', ...args);
    // Log fatal errors to database
    const errorMessage = args.map(a => String(a)).join(' ');
    errorService.logError({
      error_type: 'WhatsAppFatalError',
      error_message: errorMessage,
      location: 'whatsapp.service.ts:logger.fatal',
    });
  },
  child: () => logger,
};

export class WhatsAppService {
  private socket: WASocket | null = null;
  private qrCode: string | null = null;
  private status: ConnectionStatus = 'disconnected';
  private messageService: MessageService;
  private commandService: CommandService | null = null;
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

  /**
   * Set the command service (called after initialization to avoid circular deps)
   */
  setCommandService(commandService: CommandService): void {
    this.commandService = commandService;
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
      syncFullHistory: false, // Only sync recent messages, not full history
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
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const errorMessage = (lastDisconnect?.error as Boom)?.output?.payload?.message || 'Unknown reason';

        console.log(`Connection closed: statusCode=${statusCode}, reason=${errorMessage}`);

        this.status = 'disconnected';
        this.qrCode = null;

        // Only stop reconnecting if explicitly logged out (401)
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        if (!isLoggedOut && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(5000 * this.reconnectAttempts, 30000); // Exponential backoff, max 30s
          console.log(`Reconnecting in ${delay/1000}s... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          setTimeout(() => this.connect(), delay);
        } else if (isLoggedOut) {
          console.log('Session logged out by WhatsApp. Please scan QR code again.');
          console.log('Visit http://localhost:3000 or send "qr" command to reset session.');
        } else {
          console.log(`Max reconnect attempts (${this.maxReconnectAttempts}) reached. Restarting connection...`);
          this.reconnectAttempts = 0;
          setTimeout(() => this.connect(), 60000); // Wait 1 minute before full restart
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

    // Handle incoming calls
    this.socket.ev.on('call', async (calls) => {
      for (const call of calls) {
        console.log(`[WA] Call event: id=${call.id}, from=${call.from}, status=${call.status}, isVideo=${call.isVideo}`);
        await this.processCall(call);
      }
    });

    // Handle message deletions (track but don't delete from DB)
    this.socket.ev.on('messages.delete', (data) => {
      if ('all' in data && data.all) {
        // All messages in a chat were cleared
        console.log(`[WA] Event: All messages cleared in chat ${data.jid}`);
        eventService.logAllMessagesDelete(data.jid, { all: true });
      } else if ('keys' in data) {
        // Specific messages were deleted
        for (const key of data.keys) {
          console.log(`[WA] Event: Message deleted - id=${key.id}, chat=${key.remoteJid}`);
          eventService.logMessageDelete(key.remoteJid || '', key.id || '', {
            fromMe: key.fromMe,
            participant: key.participant,
          });
        }
      }
    });

    // Handle chat deletions (track but don't delete from DB)
    this.socket.ev.on('chats.delete', (chatIds) => {
      for (const chatId of chatIds) {
        console.log(`[WA] Event: Chat deleted - ${chatId}`);
        eventService.logChatDelete(chatId);
      }
    });
  }

  private ongoingCalls: Map<string, { startTime: number; from: string; isVideo: boolean }> = new Map();

  private async processCall(call: { id: string; from: string; status: string; isVideo?: boolean; isGroup?: boolean; offline?: boolean }): Promise<void> {
    const remoteJid = call.from;
    const isVideo = call.isVideo || false;
    const callType = isVideo ? 'video_call' : 'call';
    const callTypeLabel = isVideo ? 'Video call' : 'Call';
    const timestamp = Math.floor(Date.now() / 1000);

    // Track call states to calculate duration
    if (call.status === 'offer' || call.status === 'ringing') {
      // Incoming call started
      this.ongoingCalls.set(call.id, { startTime: timestamp, from: remoteJid, isVideo });

      const messageParams: CreateMessageParams = {
        remote_jid: remoteJid,
        sender_name: '',
        message_id: `call_${call.id}_start`,
        message_type: callType,
        content: `[${callTypeLabel} - Incoming]`,
        timestamp,
        is_group: call.isGroup || false,
        is_from_me: false,
      };

      const saved = this.messageService.createMessage(messageParams);
      if (saved) {
        console.log(`[WA] Call logged: ${callTypeLabel} from ${remoteJid}`);
      }
    } else if (call.status === 'accept') {
      // Call accepted - update start time for duration calculation
      const ongoing = this.ongoingCalls.get(call.id);
      if (ongoing) {
        ongoing.startTime = timestamp;
      }
    } else if (call.status === 'timeout' || call.status === 'reject' || call.status === 'terminate') {
      // Call ended
      const ongoing = this.ongoingCalls.get(call.id);
      let content: string;

      if (call.status === 'timeout') {
        content = `[${callTypeLabel} - Missed]`;
      } else if (call.status === 'reject') {
        content = `[${callTypeLabel} - Rejected]`;
      } else if (ongoing) {
        // Calculate duration
        const durationSeconds = timestamp - ongoing.startTime;
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        const durationStr = minutes > 0
          ? `${minutes}m ${seconds}s`
          : `${seconds}s`;
        content = `[${callTypeLabel} - ${durationStr}]`;
      } else {
        content = `[${callTypeLabel} - Ended]`;
      }

      // Update the original call message with final status
      const messageParams: CreateMessageParams = {
        remote_jid: remoteJid,
        sender_name: '',
        message_id: `call_${call.id}_end`,
        message_type: callType,
        content,
        timestamp,
        is_group: call.isGroup || false,
        is_from_me: false,
      };

      const saved = this.messageService.createMessage(messageParams);
      if (saved) {
        console.log(`[WA] Call ended: ${content} from ${remoteJid}`);
      }

      this.ongoingCalls.delete(call.id);
    }
  }

  private async processMessage(msg: proto.IWebMessageInfo): Promise<void> {
    if (!msg.key || !msg.message) return;

    // Normalize remoteJid - prefer the traditional @s.whatsapp.net format over @lid
    // This ensures sent and received messages are grouped in the same conversation
    let remoteJid = msg.key.remoteJid || '';

    // If remoteJid uses LID format and we have an alternative, use the alternative
    if (remoteJid.endsWith('@lid') && (msg.key as any).remoteJidAlt) {
      remoteJid = (msg.key as any).remoteJidAlt;
    }

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

    // Skip status/stories if not configured to store them
    if (remoteJid === 'status@broadcast' && !config.whatsapp.storeStatusMessages) {
      return;
    }

    // Get sender name and participant JID for groups
    let senderName = msg.pushName || '';
    let participantJid: string | undefined;

    if (isGroup && msg.key.participant) {
      // Prefer participantAlt (phone number format) over participant (may be LID format)
      participantJid = (msg.key as any).participantAlt || msg.key.participant;
      // Use pushName for sender_name, fallback to participant JID
      senderName = msg.pushName || '';

      // Fetch and cache group name and picture (async, non-blocking)
      this.fetchAndCacheGroupName(remoteJid).catch(() => {});
    } else if (!isGroup) {
      // For individual chats, cache contact profile picture (async, non-blocking)
      this.fetchAndCacheProfilePicture(remoteJid).catch(() => {});
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
      participant_jid: participantJid,
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

    // Check for commands (only for text messages, not from groups, and only recent messages)
    // Commands can come from configured numbers, even if fromMe is true (same account)
    // Only process commands from messages less than 60 seconds old to avoid executing on history sync
    const messageAgeSeconds = Math.floor(Date.now() / 1000) - timestamp;
    const isRecentMessage = messageAgeSeconds < 60;

    if (this.commandService && extracted.type === 'text' && !isGroup && isRecentMessage) {
      const senderNumber = remoteJid;
      console.log(`[CMD] Checking command from ${senderNumber}: "${extracted.content}" (age: ${messageAgeSeconds}s)`);
      const commandResult = await this.commandService.executeCommand(extracted.content, senderNumber);
      console.log(`[CMD] Command result:`, commandResult);
      if (commandResult && commandResult.shouldReply) {
        await this.sendTextMessage(remoteJid, commandResult.message);
      }
    } else if (this.commandService && extracted.type === 'text' && !isGroup && !isRecentMessage) {
      console.log(`[CMD] Skipping old message (age: ${messageAgeSeconds}s): "${extracted.content}"`);
    }
  }

  /**
   * Send a text message to a JID
   */
  async sendTextMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) {
      console.error('[WA] Cannot send message: socket not connected');
      return;
    }

    if (this.status !== 'connected') {
      console.error(`[WA] Cannot send message: not connected (status: ${this.status})`);
      return;
    }

    // Ensure JID has proper format
    const formattedJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;

    try {
      await this.socket.sendMessage(formattedJid, { text });
      console.log(`[WA] Reply sent to ${formattedJid}`);
    } catch (error) {
      console.error('[WA] Error sending message:', error);
    }
  }

  /**
   * Fetch and cache group metadata (name and profile picture)
   */
  async fetchAndCacheGroupName(groupJid: string): Promise<void> {
    if (!this.socket || this.status !== 'connected') {
      return;
    }

    // Check if we need to refresh (not cached or older than 24 hours)
    if (!groupService.needsRefresh(groupJid)) {
      return;
    }

    try {
      const metadata = await this.socket.groupMetadata(groupJid);
      if (metadata && metadata.subject) {
        groupService.saveGroupName(groupJid, metadata.subject);
        console.log(`[WA] Cached group name: ${metadata.subject} for ${groupJid}`);

        // Fetch and cache profile picture
        this.fetchAndCacheProfilePicture(groupJid).catch(() => {});
      }
    } catch (error) {
      // Group metadata fetch can fail for various reasons (not in group, etc.)
      console.log(`[WA] Could not fetch group metadata for ${groupJid}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Fetch and cache profile picture for a JID (group or contact)
   */
  async fetchAndCacheProfilePicture(jid: string): Promise<void> {
    if (!this.socket || this.status !== 'connected') {
      return;
    }

    const isGroup = jid.endsWith('@g.us');

    // Check if we need to refresh
    if (isGroup) {
      if (!groupService.needsRefresh(jid)) {
        return;
      }
    } else {
      if (!groupService.contactNeedsRefresh(jid)) {
        return;
      }
    }

    try {
      // Get profile picture URL from WhatsApp
      const url = await this.socket.profilePictureUrl(jid, 'image');

      if (url) {
        // Download the image
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download: ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // Generate filename based on JID
        const safeJid = jid.replace(/[@.:]/g, '_');
        const filename = `profile_${safeJid}.jpg`;
        const filePath = path.join(this.mediaPath, 'profiles', filename);

        // Ensure profiles directory exists
        const profilesDir = path.join(this.mediaPath, 'profiles');
        if (!fs.existsSync(profilesDir)) {
          fs.mkdirSync(profilesDir, { recursive: true });
        }

        // Save file
        fs.writeFileSync(filePath, buffer);

        // Save path to database
        const webPath = `/media/profiles/${filename}`;
        if (isGroup) {
          groupService.updateGroupProfilePicture(jid, webPath);
        } else {
          groupService.updateContactProfilePicture(jid, webPath);
        }

        console.log(`[WA] Cached profile picture for ${jid}`);
      }
    } catch (error) {
      // Profile picture fetch can fail (no picture set, privacy settings, etc.)
      // This is normal, just log at debug level
      console.log(`[WA] Could not fetch profile picture for ${jid}:`, error instanceof Error ? error.message : 'Unknown error');
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
      errorService.logFromException(error, 'whatsapp.service.ts:downloadMedia', {
        messageId: msg.key?.id,
        remoteJid: msg.key?.remoteJid,
        type,
        mimetype,
      });
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
      // Use end() instead of logout() to preserve session
      this.socket.end(undefined);
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
