/**
 * Download Result Folder API
 * 
 * Download a specific Result_N folder as a ZIP file from AWS S3
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, createAuthResponse } from '@/lib/auth';
import { createAWSS3Storage } from '@/lib/aws-s3-storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  // Verify authentication
  const token = await verifyAuth(request);
  if (!token) {
    return createAuthResponse('Authentication required');
  }

  const { folderId } = await params;

  try {
    // Use AWS S3 for downloading results
    const s3Storage = createAWSS3Storage();
    
    if (!s3Storage) {
      return NextResponse.json(
        { error: 'AWS S3 storage not configured' },
        { status: 503 }
      );
    }

    console.log(`[DOWNLOAD] Fetching ${folderId} from AWS S3...`);
    
    // Get list of files in this folder from S3
    const files = await s3Storage.listFolderFiles(folderId);
    
    if (files.length === 0) {
      console.error(`[DOWNLOAD] No files found for ${folderId}`);
      return NextResponse.json(
        { error: 'Result folder not found or empty' },
        { status: 404 }
      );
    }

    console.log(`[DOWNLOAD] Found ${files.length} files in ${folderId}`);

    // Create ZIP archive in memory
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Download each file and add to ZIP
    await Promise.all(
      files.map(async (file) => {
        try {
          const key = `${folderId}/${file.name}`;
          const blob = await s3Storage.downloadFile(key);
          
          if (blob) {
            const content = await blob.arrayBuffer();
            zip.file(file.name, content);
            console.log(`[DOWNLOAD] Added ${file.name} to ZIP`);
          } else {
            console.warn(`[DOWNLOAD] Failed to download ${file.name}`);
          }
        } catch (error) {
          console.error(`[DOWNLOAD] Error downloading ${file.name}:`, error);
        }
      })
    );

    // Generate ZIP
    const zipBlob = await zip.generateAsync({ type: 'arraybuffer' });
    
    console.log(`[DOWNLOAD] Generated ZIP for ${folderId} (${zipBlob.byteLength} bytes)`);

    return new NextResponse(zipBlob, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${folderId}.zip"`,
        'Content-Length': zipBlob.byteLength.toString(),
      },
    });

  } catch (error) {
    console.error('[DOWNLOAD] Error:', error);
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Download failed' },
      { status: 500 }
    );
  }
}
