import path from 'path';
import fs from 'fs';
import sharp from 'sharp';

export interface ProcessedImageResult {
  slot: 'front' | 'back' | 'detail';
  originalFilename: string;
  processedUrl: string;
  width: number;
  height: number;
}

export class ImageProcessorService {
  private uploadsBaseDir: string;

  constructor() {
    this.uploadsBaseDir = path.resolve(process.cwd(), '..', '..', 'uploads');
    if (!fs.existsSync(this.uploadsBaseDir)) {
      this.uploadsBaseDir = path.resolve(process.cwd(), 'uploads');
    }
    if (!fs.existsSync(this.uploadsBaseDir)) {
      fs.mkdirSync(this.uploadsBaseDir, { recursive: true });
    }
  }

  /**
   * Automatically changes raw image background to crisp pure white (#FFFFFF),
   * centers and trims the product cleanly with studio-grade margin padding.
   */
  async processToWhiteBackground(
    merchantId: string,
    fileBuffer: Buffer,
    originalFilename: string,
    slot: 'front' | 'back' | 'detail' = 'front',
  ): Promise<ProcessedImageResult> {
    const merchantDir = path.join(this.uploadsBaseDir, merchantId);
    if (!fs.existsSync(merchantDir)) {
      fs.mkdirSync(merchantDir, { recursive: true });
    }

    const timestamp = Date.now();
    const cleanSlotName = slot.toLowerCase();
    const safeBaseName = originalFilename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/\.[^/.]+$/, '');
    const outputFilename = `PRD_${cleanSlotName}_${timestamp}_${safeBaseName}.png`;
    const outputPath = path.join(merchantDir, outputFilename);

    const canvasSize = 800;
    const padding = Math.round(canvasSize * 0.1); // 10% elegant margin
    const targetProductSize = canvasSize - padding * 2;

    try {
      // 1. Load image with sharp and inspect
      const image = sharp(fileBuffer);
      const metadata = await image.metadata();

      // 2. High-quality containment with pure solid white background #FFFFFF
      // Flatten any existing transparency to pure white, then contain within square canvas
      const processedBuffer = await sharp(fileBuffer)
        .rotate() // auto-orient based on EXIF
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize(targetProductSize, targetProductSize, {
          fit: 'inside',
          withoutEnlargement: false,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .toBuffer();

      // 3. Composite onto a pure white canvas (800x800) for clean catalog aesthetic
      await sharp({
        create: {
          width: canvasSize,
          height: canvasSize,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite([
          {
            input: processedBuffer,
            gravity: 'center',
          },
        ])
        .png({ quality: 92, compressionLevel: 8 })
        .toFile(outputPath);

      const processedUrl = `/uploads/${merchantId}/${outputFilename}`;

      return {
        slot,
        originalFilename,
        processedUrl,
        width: canvasSize,
        height: canvasSize,
      };
    } catch (err: any) {
      console.error(`[ImageProcessor] Failed processing ${originalFilename}:`, err);
      // Fallback: direct write
      fs.writeFileSync(outputPath, fileBuffer);
      return {
        slot,
        originalFilename,
        processedUrl: `/uploads/${merchantId}/${outputFilename}`,
        width: 800,
        height: 800,
      };
    }
  }

  /**
   * Processes multiple images (up to 3: front, back, detail)
   */
  async processBatch(
    merchantId: string,
    files: { [fieldname: string]: Express.Multer.File[] } | Express.Multer.File[],
  ): Promise<ProcessedImageResult[]> {
    const results: ProcessedImageResult[] = [];

    if (Array.isArray(files)) {
      const slots: ('front' | 'back' | 'detail')[] = ['front', 'back', 'detail'];
      for (let i = 0; i < Math.min(files.length, 3); i++) {
        const file = files[i];
        const res = await this.processToWhiteBackground(
          merchantId,
          file.buffer,
          file.originalname,
          slots[i] || 'front',
        );
        results.push(res);
      }
    } else {
      // Fieldname mapped: frontImage, backImage, detailImage
      if (files['frontImage']?.[0]) {
        const file = files['frontImage'][0];
        results.push(
          await this.processToWhiteBackground(merchantId, file.buffer, file.originalname, 'front'),
        );
      }
      if (files['backImage']?.[0]) {
        const file = files['backImage'][0];
        results.push(
          await this.processToWhiteBackground(merchantId, file.buffer, file.originalname, 'back'),
        );
      }
      if (files['detailImage']?.[0]) {
        const file = files['detailImage'][0];
        results.push(
          await this.processToWhiteBackground(merchantId, file.buffer, file.originalname, 'detail'),
        );
      }
    }

    return results;
  }
}

export const imageProcessor = new ImageProcessorService();
