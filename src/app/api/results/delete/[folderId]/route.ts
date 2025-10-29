/**
 * Delete Result Folder API
 * 
 * Delete a specific Result_N folder from storage
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, createAuthResponse } from '@/lib/auth';
import { list, del } from '@vercel/blob';

export async function DELETE(
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
    let deletedCount = 0;

    // Delete from Vercel Blob
    try {
      const { blobs } = await list({ prefix: `solver_output/${folderId}/` });
      
      if (blobs.length > 0) {
        // Delete all blobs in this folder
        await Promise.all(
          blobs.map(async (blob) => {
            try {
              await del(blob.url);
              deletedCount++;
            } catch (error) {
              console.error(`Failed to delete ${blob.pathname}:`, error);
            }
          })
        );

        console.log(`[DELETE] Removed ${deletedCount} files from Vercel Blob for ${folderId}`);
      }
    } catch (error) {
      console.error('[DELETE] Vercel Blob error:', error);
    }

    // Try to delete from AWS S3 if configured
    try {
      const AWS_LAMBDA_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
      if (AWS_LAMBDA_URL) {
        const response = await fetch(`${AWS_LAMBDA_URL}/results/delete/${folderId}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          console.log(`[DELETE] Also removed from AWS S3: ${folderId}`);
        }
      }
    } catch (error) {
      console.error('[DELETE] AWS deletion failed:', error);
      // Non-fatal - continue even if AWS deletion fails
    }

    if (deletedCount === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Result folder not found or already deleted' 
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Deleted ${folderId}`,
      filesDeleted: deletedCount,
    });

  } catch (error) {
    console.error('[DELETE] Error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Delete failed' 
      },
      { status: 500 }
    );
  }
}
