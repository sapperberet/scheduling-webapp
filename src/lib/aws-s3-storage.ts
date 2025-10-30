/**
 * AWS S3 Storage Module
 * Handles all S3 operations for storing solver results
 * Uses AWS SDK v3  for better tree-shaking and performance
 */

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface S3File {
  name: string;
  path: string;
  size: number;
  lastModified: Date;
  url?: string;
}

export interface S3UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

/**
 * AWS S3 Storage Client
 * Provides methods for uploading, downloading, and listing files in S3
 */
export class AWSS3Storage {
  private config: S3Config;
  private apiUrl: string;

  constructor(config: S3Config, apiUrl: string) {
    this.config = config;
    this.apiUrl = apiUrl;
  }

  /**
   * Upload a file to S3 via Lambda proxy
   */
  async uploadFile(
    key: string,
    content: Buffer | string,
    options?: S3UploadOptions
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/storage/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
          content: Buffer.isBuffer(content) ? content.toString('base64') : btoa(content),
          contentType: options?.contentType || 'application/octet-stream',
          metadata: options?.metadata,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          success: false,
          error: error.message || `Upload failed: ${response.status}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        url: result.url,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  /**
   * Upload multiple files as a packaged result folder
   */
  async uploadPackagedResults(
    folderName: string,
    files: Record<string, string> // filename -> base64 content
  ): Promise<{ success: boolean; folderName: string; error?: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/storage/upload-package`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          folder_name: folderName,
          files,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          success: false,
          folderName,
          error: error.message || `Upload failed: ${response.status}`,
        };
      }

      const result = await response.json();
      return {
        success: true,
        folderName: result.folder_name || folderName,
      };
    } catch (error) {
      return {
        success: false,
        folderName,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }

  /**
   * List all Result_N folders in S3
   */
  async listResultFolders(): Promise<string[]> {
    try {
      // Call Lambda API directly (no auth required for public endpoint)
      const response = await fetch(`${this.apiUrl}/results/folders`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Failed to list S3 folders:', response.status);
        return [];
      }

      const data = await response.json();
      // Lambda returns { folders: [...] }, extract just the names
      const folders: Array<{ name?: string; [key: string]: unknown }> = data.folders || [];
      return folders.map((f) => (typeof f === 'string' ? f : f.name || ''));
    } catch (error) {
      console.error('Error listing S3 folders:', error);
      return [];
    }
  }

  /**
   * List files in a specific result folder
   */
  async listFolderFiles(folderName: string): Promise<S3File[]> {
    try {
      const response = await fetch(`${this.apiUrl}/storage/list-files/${folderName}`, {
        method: 'GET',
      });

      if (!response.ok) {
        console.error(`Failed to list files in ${folderName}:`, response.status);
        return [];
      }

      const data = await response.json();
      return data.files || [];
    } catch (error) {
      console.error(`Error listing files in ${folderName}:`, error);
      return [];
    }
  }

  /**
   * Download a file from S3
   */
  async downloadFile(key: string): Promise<Blob | null> {
    try {
      const response = await fetch(`${this.apiUrl}/storage/download/${encodeURIComponent(key)}`, {
        method: 'GET',
      });

      if (!response.ok) {
        console.error(`Failed to download ${key}:`, response.status);
        return null;
      }

      return await response.blob();
    } catch (error) {
      console.error(`Error downloading ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete a result folder from S3
   */
  async deleteFolder(folderName: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/storage/delete-folder/${folderName}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return {
          success: false,
          error: error.message || `Delete failed: ${response.status}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Delete failed',
      };
    }
  }

  /**
   * Get a presigned URL for downloading a file
   */
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string | null> {
    try {
      const response = await fetch(`${this.apiUrl}/storage/presigned-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
          expires_in: expiresIn,
        }),
      });

      if (!response.ok) {
        console.error('Failed to get presigned URL:', response.status);
        return null;
      }

      const data = await response.json();
      return data.url || null;
    } catch (error) {
      console.error('Error getting presigned URL:', error);
      return null;
    }
  }
}

/**
 * Create AWS S3 storage client from environment variables
 */
export function createAWSS3Storage(): AWSS3Storage | null {
  const apiUrl = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
  const bucket = process.env.NEXT_PUBLIC_AWS_S3_BUCKET || 'scheduling-solver-results';
  const region = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';

  if (!apiUrl) {
    console.warn('AWS Solver URL not configured, S3 storage unavailable');
    return null;
  }

  return new AWSS3Storage(
    {
      bucket,
      region,
    },
    apiUrl
  );
}
