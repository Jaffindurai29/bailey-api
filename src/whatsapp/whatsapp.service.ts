import { Injectable, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay,
  WASocket,
  AuthenticationState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as QRCode from 'qrcode';
import * as qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private sockets: Map<string, WASocket> = new Map();
  private qrs: Map<string, string> = new Map();
  private connectionStatus: Map<string, string> = new Map();
  private readonly sessionsDir = path.join(process.cwd(), 'sessions');
  private deletingSessions: Set<string> = new Set();

  async onModuleInit() {
    await fs.ensureDir(this.sessionsDir);
    const folders = await fs.readdir(this.sessionsDir);
    for (const folder of folders) {
      if (folder.startsWith('auth_info_')) {
        const mobile = folder.replace('auth_info_', '');
        this.initWhatsapp(mobile);
      }
    }
  }

  onModuleDestroy() {
    for (const [mobile, sock] of this.sockets) {
      sock.logout();
    }
  }

  private contactStore: Map<string, any[]> = new Map();

  async initWhatsapp(mobile: string) {
    const sessionDir = path.join(this.sessionsDir, `auth_info_${mobile}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }) as any,
    });

    this.sockets.set(mobile, sock);

    sock.ev.on('creds.update', saveCreds);

    // Sync contacts
    sock.ev.on('contacts.upsert', (contacts) => {
      const existing = this.contactStore.get(mobile) || [];
      const updated = [...existing];
      for (const contact of contacts) {
        const index = updated.findIndex(c => c.id === contact.id);
        if (index > -1) updated[index] = { ...updated[index], ...contact };
        else updated.push(contact);
      }
      this.contactStore.set(mobile, updated);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) this.qrs.set(mobile, qr);
      if (connection === 'open') {
        this.connectionStatus.set(mobile, 'connected');
        this.qrs.delete(mobile);
      }
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (statusCode !== DisconnectReason.loggedOut) this.initWhatsapp(mobile);
        else await this.deleteSession(mobile);
      }
    });

    return sock;
  }

  async getContacts(mobile: string) {
    return this.contactStore.get(mobile) || [];
  }

  async getQR(mobile: string): Promise<string | null> {
    const qr = this.qrs.get(mobile);
    if (!qr) return null;
    return QRCode.toDataURL(qr);
  }

  getStatus(mobile: string): string {
    return this.connectionStatus.get(mobile) || 'not_started';
  }

  async sendMessage(mobile: string, target: string, message: string) {
    const sock = this.sockets.get(mobile);
    if (!sock) throw new Error(`Socket not found for ${mobile}`);
    
    const jid = this.formatJid(target);
    await sock.sendMessage(jid, { text: message });
    await delay(1000);
  }

  async sendImage(mobile: string, target: string, imageBuffer: Buffer, caption?: string) {
    const sock = this.sockets.get(mobile);
    if (!sock) throw new Error(`Socket not found for ${mobile}`);

    const jid = this.formatJid(target);
    await sock.sendMessage(jid, { 
      image: imageBuffer, 
      caption 
    });
    await delay(1000);
  }

  async getGroups(mobile: string) {
    const sock = this.sockets.get(mobile);
    if (!sock) throw new Error(`Socket not found for ${mobile}`);
    
    this.logger.log(`Fetching groups for ${mobile}...`);
    try {
      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups);
      this.logger.log(`Found ${groupList.length} groups for ${mobile}.`);
      return groupList;
    } catch (error) {
      this.logger.error(`Failed to fetch groups: ${error.message}`);
      throw error;
    }
  }

  async deleteSession(mobile: string) {
    if (this.deletingSessions.has(mobile)) return;
    this.deletingSessions.add(mobile);

    this.logger.log(`Logging out and deleting session for ${mobile}...`);
    
    const sock = this.sockets.get(mobile);

    // 1. Clear from memory first to prevent concurrent access
    this.sockets.delete(mobile);
    this.qrs.delete(mobile);
    this.connectionStatus.delete(mobile);
    this.contactStore.delete(mobile);

    // 2. End the socket connection if it exists
    if (sock) {
      try {
        await sock.logout(); // This clears the remote session too
        sock.end(undefined);
      } catch (e) {
        this.logger.warn(`Error during socket logout for ${mobile}: ${e.message}`);
      }
    }

    // 3. Delete the session directory
    const sessionDir = path.join(this.sessionsDir, `auth_info_${mobile}`);
    try {
      if (await fs.pathExists(sessionDir)) {
        await fs.remove(sessionDir);
        this.logger.log(`Session directory deleted for ${mobile}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete session directory: ${error.message}`);
    } finally {
      this.deletingSessions.delete(mobile);
    }
  }

  async deleteAllSessions() {
    this.logger.log('Deleting all WhatsApp sessions...');
    const mobiles = Array.from(this.sockets.keys());
    for (const mobile of mobiles) {
      await this.deleteSession(mobile);
    }
    // Final wipe just in case
    try {
      await fs.emptyDir(this.sessionsDir);
    } catch (e) {
      this.logger.error(`Failed to empty sessions directory: ${e.message}`);
    }
  }

  private formatJid(target: string): string {
    if (target.includes('@')) return target; // Already a JID
    const cleanPhone = target.replace(/\D/g, '');
    // If it's exactly 10 digits, assume it's an Indian number and prepend 91
    // If it's more than 10 digits, assume it already has a country code
    const finalPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    return `${finalPhone}@s.whatsapp.net`;
  }
}
