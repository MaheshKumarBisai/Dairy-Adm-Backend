import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class AdminS3Service {
  private s3Client: S3Client;
  private bucketName: string;
  private region: string;

  constructor() {
    this.region = process.env.AWS_REGION || 'us-east-2';
    this.bucketName = process.env.AWS_S3_BUCKET_NAME || '';

    this.s3Client = new S3Client({
      region: this.region,
    });
  }

  get isConfigured(): boolean {
    return Boolean(this.bucketName);
  }

  async uploadFile(key: string, buffer: Buffer, contentType: string = 'image/png'): Promise<string> {
    if (!this.bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME is not configured');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await this.s3Client.send(command);
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async getPresignedUploadUrl(key: string, contentType: string = 'image/png'): Promise<{ uploadUrl: string; fileUrl: string }> {
    if (!this.bucketName) {
      throw new Error('AWS_S3_BUCKET_NAME is not configured');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 300 });
    const fileUrl = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
    return { uploadUrl, fileUrl };
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.bucketName) return;

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      })
    );
  }
}

export const adminS3Service = new AdminS3Service();

