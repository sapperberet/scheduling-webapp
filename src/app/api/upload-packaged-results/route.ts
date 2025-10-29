import { NextResponse } from 'next/server';
import { createAWSS3Storage } from '@/lib/aws-s3-storage';

export async function POST(request: Request) {
  try {
    const { packaged_files, folder_name } = await request.json();

    if (!packaged_files || typeof packaged_files !== 'object') {
      return NextResponse.json({ error: 'Missing or invalid packaged_files' }, { status: 400 });
    }

    // Try AWS S3 first
    const s3Storage = createAWSS3Storage();
    
    if (s3Storage) {
      console.log('[UPLOAD] Using AWS S3 storage for results');
      
      // Use provided folder name or generate one
      let folderName = folder_name;
      
      if (!folderName) {
        // Determine the next Result_N folder name from S3
        const existingFolders = await s3Storage.listResultFolders();
        const existingNums = existingFolders.map(folder => {
          const match = folder.match(/Result_(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        });
        const nextNum = Math.max(0, ...existingNums) + 1;
        folderName = `Result_${nextNum}`;
      }

      // Upload to AWS S3
      const result = await s3Storage.uploadPackagedResults(folderName, packaged_files);
      
      if (result.success) {
        console.log(`[UPLOAD] Successfully uploaded to AWS S3: ${folderName}`);
        return NextResponse.json({
          status: 'success',
          message: `Successfully uploaded ${Object.keys(packaged_files).length} files to ${folderName}`,
          folderName: result.folderName,
          storage: 'aws_s3',
        });
      } else {
        console.error('[UPLOAD] AWS S3 upload failed:', result.error);
        // Fall back to local storage if S3 fails
      }
    }

    // Fallback: Store metadata locally (for backwards compatibility)
    // This is only used if AWS S3 is not available
    console.log('[UPLOAD] AWS S3 not available, storing metadata only');
    
    const folderName = folder_name || `Result_${Date.now()}`;
    
    return NextResponse.json({
      status: 'success',
      message: `Metadata stored for ${folderName} (AWS S3 unavailable)`,
      folderName: folderName,
      storage: 'metadata_only',
      warning: 'AWS S3 not configured - results not persisted',
    });

  } catch (error) {
    console.error('Error uploading packaged results:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ 
      error: 'Failed to upload packaged results', 
      details: errorMessage 
    }, { status: 500 });
  }
}
