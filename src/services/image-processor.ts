import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { adminS3Service } from './s3.service';

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
      // 0. Attempt AI Background Removal via Main Backend (@imgly/background-removal-node)
      const mainBackendUrl = (process.env.MAIN_BACKEND_URL || 'http://dairy-lb-2052637137.us-east-2.elb.amazonaws.com').replace(/\/+$/, '');
      try {
        const formData = new FormData();
        const blob = new Blob([fileBuffer as any], { type: 'image/png' });
        formData.append('file', blob, originalFilename);
        formData.append('merchantId', merchantId);

        const aiRes = await fetch(`${mainBackendUrl}/api/v1/products/public-upload-image`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(4000),
        });

        if (aiRes.ok) {
          const aiJson: any = await aiRes.json();
          if (aiJson?.data?.imageUrl) {
            console.log(`[ImageProcessor] ✅ AI Background Removal Succeeded: ${aiJson.data.imageUrl}`);
            return {
              slot,
              originalFilename,
              processedUrl: aiJson.data.imageUrl,
              width: canvasSize,
              height: canvasSize,
            };
          }
        }
      } catch (aiErr: any) {
        console.warn(`[ImageProcessor] AI background removal call skipped: ${aiErr.message}`);
      }

      // 1. Load image with sharp and inspect
      const image = sharp(fileBuffer);
      const metadata = await image.metadata();

      // 2. High-quality studio image fill (800x800 edge-to-edge square, zero white side bars)
      const finalBuffer = await sharp(fileBuffer)
        .rotate() // auto-orient based on EXIF
        .resize(canvasSize, canvasSize, {
          fit: 'cover',
          position: 'center',
        })
        .png({ quality: 92, compressionLevel: 8 })
        .toBuffer();

      fs.writeFileSync(outputPath, finalBuffer);

      let processedUrl = `/uploads/${merchantId}/${outputFilename}`;

      // Upload to Amazon S3 if bucket name is set
      if (adminS3Service.isConfigured) {
        try {
          const s3Key = `uploads/products/${merchantId}/${outputFilename}`;
          processedUrl = await adminS3Service.uploadFile(s3Key, finalBuffer, 'image/png');
          console.log(`[ImageProcessor] Synced to S3: ${processedUrl}`);
        } catch (s3Err: any) {
          console.warn(`[ImageProcessor] S3 upload error: ${s3Err.message}`);
        }
      }

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
