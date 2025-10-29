/**
 * Delete Result Folder API
 * 
 * Delete a specific Result_N folder from AWS S3 storage
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, createAuthResponse } from '@/lib/auth';
import { createAWSS3Storage } from '@/lib/aws-s3-storage';

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
    // Use AWS S3 for deletion
    const s3Storage = createAWSS3Storage();
    
    if (!s3Storage) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'AWS S3 storage not configured' 
        },
        { status: 503 }
      );
    }

    console.log(`[DELETE] Deleting ${folderId} from AWS S3...`);

    // Delete from AWS S3
    const result = await s3Storage.deleteFolder(folderId);

    if (!result.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: result.error || 'Failed to delete from AWS S3' 
        },
        { status: 500 }
      );
    }

    console.log(`[DELETE] Successfully deleted ${folderId} from AWS S3`);

    return NextResponse.json({
      success: true,
      message: `Deleted ${folderId} from AWS S3`,
      storage: 'aws_s3',
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
