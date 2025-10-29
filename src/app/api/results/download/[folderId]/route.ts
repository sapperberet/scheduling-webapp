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

    // First, get the list of runs to find the run_id for this folder
    const runsResponse = await fetch(`${AWS_LAMBDA_URL}/runs`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!runsResponse.ok) {
      return null;
    }

    const runsData = await runsResponse.json();
    let targetRunId: string | null = null;

    // Find the run_id that matches this folder
    if (runsData.runs && Array.isArray(runsData.runs)) {
      for (const run of runsData.runs) {
        if (run.output_directory && run.output_directory.includes(folderId)) {
          targetRunId = run.run_id;
          break;
        }
      }
    }

    if (!targetRunId) {
      console.error(`[AWS DOWNLOAD] No run found for folder ${folderId}`);
      return null;
    }

    // Get the list of files for this run
    const filesResponse = await fetch(`${AWS_LAMBDA_URL}/output/${targetRunId}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!filesResponse.ok) {
      return null;
    }

    const filesData = await filesResponse.json();
    
    if (!filesData.files || filesData.files.length === 0) {
      console.error(`[AWS DOWNLOAD] No files found for run ${targetRunId}`);
      return null;
    }

    // Create ZIP archive in memory using all files
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Download each file and add to ZIP
    await Promise.all(
      filesData.files.map(async (file: { name: string }) => {
        try {
          const fileResponse = await fetch(
            `${AWS_LAMBDA_URL}/download/${targetRunId}/${file.name}`,
            { signal: AbortSignal.timeout(30000) }
          );

          if (fileResponse.ok) {
            const content = await fileResponse.arrayBuffer();
            zip.file(file.name, content);
          }
        } catch (error) {
          console.error(`Failed to download ${file.name}:`, error);
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
    console.error('[AWS DOWNLOAD] Error:', error);
    return null;
  }
}
