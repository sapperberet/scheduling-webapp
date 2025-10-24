/**
 * Download Result Folder API
 * 
 * Download a specific Result_N folder as a ZIP file
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, createAuthResponse } from '@/lib/auth';
import { list } from '@vercel/blob';

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
    // Check if folder exists in Vercel Blob
    const { blobs } = await list({ prefix: `solver_output/${folderId}/` });

    if (blobs.length > 0) {
      // Download from Vercel Blob
      return await downloadFromVercelBlob(folderId, blobs);
    }

    // Try AWS S3
    const awsResult = await downloadFromAWS(folderId);
    if (awsResult) {
      return awsResult;
    }

    return NextResponse.json(
      { error: 'Result folder not found' },
      { status: 404 }
    );

  } catch (error) {
    console.error('[DOWNLOAD] Error:', error);
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Download failed' },
      { status: 500 }
    );
  }
}

async function downloadFromVercelBlob(
  folderId: string,
  blobs: Array<{ pathname: string; url: string }>
) {
  try {
    // Create ZIP archive in memory
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Download all files and add to ZIP
    await Promise.all(
      blobs.map(async (blob) => {
        try {
          const response = await fetch(blob.url);
          const content = await response.arrayBuffer();
          const filename = blob.pathname.replace(`solver_output/${folderId}/`, '');
          zip.file(filename, content);
        } catch (error) {
          console.error(`Failed to download ${blob.pathname}:`, error);
        }
      })
    );

    // Generate ZIP
    const zipBlob = await zip.generateAsync({ type: 'arraybuffer' });

    return new NextResponse(zipBlob, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${folderId}.zip"`,
      },
    });

  } catch (error) {
    console.error('[ZIP] Error creating archive:', error);
    throw error;
  }
}

async function downloadFromAWS(folderId: string): Promise<NextResponse | null> {
  try {
    const AWS_LAMBDA_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
    if (!AWS_LAMBDA_URL) {
      return null;
    }

    const response = await fetch(`${AWS_LAMBDA_URL}/download/folder/${folderId}`, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return null;
    }

    // Stream the ZIP from AWS to client
    const zipData = await response.arrayBuffer();

    return new NextResponse(zipData, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${folderId}.zip"`,
      },
    });

  } catch {
    return null;
  }
}
