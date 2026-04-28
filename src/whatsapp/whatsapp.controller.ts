import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import * as express from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('whatsapp')
export class WhatsappController {
  private readonly PRIVATE_KEY = 'Tf4Q*J592#t#9Az@z0T*Lt5sLIg#1=o';

  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('start')
  async start(@Body('mobile') mobile: string, @Res() res: express.Response) {
    if (!mobile) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Missing mobile' });
    }
    await this.whatsappService.initWhatsapp(mobile);
    return res.status(HttpStatus.OK).json({ success: true });
  }

  @Get('qr')
  async getQR(@Query('mobile') mobile: string, @Res() res: express.Response) {
    const qrDataUrl = await this.whatsappService.getQR(mobile);
    if (qrDataUrl) {
      return res.json({ qr: qrDataUrl });
    }
    return res.status(HttpStatus.NOT_FOUND).json({ message: 'QR not yet available' });
  }

  @Get('status')
  async getStatus(@Query('mobile') mobile: string, @Res() res: express.Response) {
    const status = this.whatsappService.getStatus(mobile);
    return res.json({ status });
  }

  @Get('groups')
  async getGroups(@Query('mobile') mobile: string, @Res() res: express.Response) {
    try {
      const groups = await this.whatsappService.getGroups(mobile);
      return res.json({ groups });
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }

  @Get('contacts')
  async getContacts(@Query('mobile') mobile: string, @Res() res: express.Response) {
    try {
      const contacts = await this.whatsappService.getContacts(mobile);
      return res.json({ contacts });
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }

  @Post('message')
  async message(
    @Body() body: { targetJid: string; message: string; key: string; senderPhoneNo: string },
    @Res() res: express.Response,
  ) {
    const { targetJid, message, key, senderPhoneNo } = body;

    if (key !== this.PRIVATE_KEY) {
      return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'Unauthorized access' });
    }

    try {
      await this.whatsappService.sendMessage(senderPhoneNo, targetJid, message);
      return res.json({ success: true, message: `Message sent to ${targetJid}` });
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message });
    }
  }

  @Post('message/image')
  @UseInterceptors(FileInterceptor('image'))
  async sendImage(
    @Body() body: { targetJid: string; message?: string; key: string; senderPhoneNo: string; image?: string },
    @UploadedFile() file: Express.Multer.File,
    @Res() res: express.Response,
  ) {
    const { targetJid, message, key, senderPhoneNo, image } = body;

    if (key !== this.PRIVATE_KEY) {
      return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'Unauthorized access' });
    }

    try {
      let imageBuffer: Buffer;
      if (file) {
        imageBuffer = file.buffer;
      } else if (image) {
        const base64_image = image.replace(/^data:image\/[a-z]+;base64,/, '');
        imageBuffer = Buffer.from(base64_image, 'base64');
      } else {
        return res.status(HttpStatus.BAD_REQUEST).json({ error: 'No image provided' });
      }

      await this.whatsappService.sendImage(senderPhoneNo, targetJid, imageBuffer, message);
      return res.status(HttpStatus.OK).json({ success: true, message: `Image sent to ${targetJid}` });
    } catch (error) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, error: error.message });
    }
  }

  @Post('delete-session')
  async deleteSession(@Body('mobile') mobile: string, @Res() res: express.Response) {
    if (!mobile) return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Missing mobile' });
    await this.whatsappService.deleteSession(mobile);
    return res.json({ success: true, message: 'Session deleted' });
  }
}
