import sharp from 'sharp';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import type { ImageOverlayOptions, ImageOverlayResult } from '@snapalarm/shared-types';

// ============================================================
// ImageProcessor — Sharp-based image compositing
//
// - Downloads original image from S3
// - Renders text overlay with responsive sizing and shadow
// - Optionally applies "AI Generated" watermark (community pool)
// - Outputs 800x800 JPEG and uploads to S3
// - Returns signed URL (15-min expiry for private images)
// ============================================================

const OUTPUT_WIDTH = 800;
const OUTPUT_HEIGHT = 800;
const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes

export class ImageProcessor {
  private s3: S3Client;

  constructor(
    private readonly config: {
      aws_region: string;
      aws_access_key_id: string;
      aws_secret_access_key: string;
      bucket_private: string;
      bucket_public: string;
    },
  ) {
    this.s3 = new S3Client({
      region: config.aws_region,
      credentials: {
        accessKeyId: config.aws_access_key_id,
        secretAccessKey: config.aws_secret_access_key,
      },
    });
  }

  async overlay(options: ImageOverlayOptions): Promise<ImageOverlayResult> {
    const width = options.output_width ?? OUTPUT_WIDTH;
    const height = options.output_height ?? OUTPUT_HEIGHT;

    // 1. Download original from S3
    const input_buffer = await this.downloadFromS3(options.input_s3_key);

    // 2. Resize to target dimensions
    const base = await sharp(input_buffer)
      .resize(width, height, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 85 })
      .toBuffer();

    // 3. Build SVG text overlay
    const svg_overlay = this.buildTextOverlay(options.text, width, height);

    // 4. Build watermark if needed
    const composites: sharp.OverlayOptions[] = [
      { input: Buffer.from(svg_overlay), top: 0, left: 0 },
    ];

    if (options.watermark) {
      const watermark_svg = this.buildWatermark(width);
      composites.push({ input: Buffer.from(watermark_svg), gravity: 'southeast' });
    }

    // 5. Composite overlays onto base image
    const output_buffer = await sharp(base)
      .composite(composites)
      .jpeg({ quality: 85 })
      .toBuffer();

    // 6. Upload to S3
    const output_s3_key = options.input_s3_key.replace('originals/', 'generated/') + '_overlay.jpg';
    const bucket = options.watermark ? this.config.bucket_public : this.config.bucket_private;

    await this.uploadToS3(bucket, output_s3_key, output_buffer);

    // 7. Get URL (signed for private, public URL for community pool)
    const output_url = options.watermark
      ? `https://${bucket}.s3.${this.config.aws_region}.amazonaws.com/${output_s3_key}`
      : await this.getSignedUrl(bucket, output_s3_key);

    return {
      output_s3_key,
      output_url,
      size_bytes: output_buffer.length,
    };
  }

  // ---- Fallback: plain Sharp overlay with no AI ------------

  async overlayFallback(input_s3_key: string, alarm_title: string): Promise<ImageOverlayResult> {
    return this.overlay({
      input_s3_key,
      text: alarm_title,
      watermark: false,
    });
  }

  // ---- SVG helpers -----------------------------------------

  private buildTextOverlay(text: string, width: number, height: number): string {
    const lines = this.wrapText(text, 28); // ~28 chars per line at 36px
    const line_height = 44;
    const total_height = lines.length * line_height + 20;
    const y_start = height - total_height - 24;
    const font_size = 36;

    const text_elements = lines
      .map((line, i) => {
        const y = y_start + i * line_height + font_size;
        return `
        <text
          x="${width / 2}"
          y="${y}"
          text-anchor="middle"
          font-family="Arial, sans-serif"
          font-size="${font_size}"
          font-weight="bold"
          fill="white"
          filter="url(#shadow)"
          xml:space="preserve">${this.escapeXml(line)}</text>`;
      })
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="2" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.8)"/>
        </filter>
      </defs>
      <rect x="0" y="${y_start - 8}" width="${width}" height="${total_height + 16}"
        fill="rgba(0,0,0,0.45)" rx="0"/>
      ${text_elements}
    </svg>`;
  }

  private buildWatermark(width: number): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24">
      <text x="${width - 8}" y="18"
        text-anchor="end"
        font-family="Arial, sans-serif"
        font-size="12"
        fill="rgba(255,255,255,0.6)">AI Generated</text>
    </svg>`;
  }

  private wrapText(text: string, max_chars: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      if ((current + ' ' + word).trim().length <= max_chars) {
        current = (current + ' ' + word).trim();
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ---- S3 helpers ------------------------------------------

  private async downloadFromS3(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: this.config.bucket_private, Key: key });
    const response = await this.s3.send(command);
    const stream = response.Body as Readable;
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private async uploadToS3(bucket: string, key: string, buffer: Buffer): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
      }),
    );
  }

  private async getSignedUrl(bucket: string, key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
  }
}
