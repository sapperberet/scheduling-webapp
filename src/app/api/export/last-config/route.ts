import { NextResponse } from 'next/server';
import { createAWSS3Storage } from '@/lib/aws-s3-storage';
import { SchedulingCase } from '@/types/scheduling';

/**
 * GET /api/export/last-config
 * Fetches the last configuration file from S3 (from the most recent Result_N folder)
 */
export async function GET() {
  try {
    const s3Storage = createAWSS3Storage();
    
    if (!s3Storage) {
      return NextResponse.json(
        { message: 'S3 storage not configured' },
        { status: 500 }
      );
    }

    // List all result folders to find the most recent one
    const folders = await s3Storage.listResultFolders();
    
    if (!folders || folders.length === 0) {
      return NextResponse.json(
        { message: 'No result folders found in S3' },
        { status: 404 }
      );
    }

    // Sort folders by numeric ID descending to get the most recent
    const sortedFolders = folders.sort((a, b) => {
      const aNum = parseInt(a.replace(/Result_(\d+)/, '$1'), 10) || 0;
      const bNum = parseInt(b.replace(/Result_(\d+)/, '$1'), 10) || 0;
      return bNum - aNum;
    });

    const mostRecentFolder = sortedFolders[0];
    
    if (!mostRecentFolder) {
      return NextResponse.json(
        { message: 'Could not determine most recent result folder' },
        { status: 404 }
      );
    }

    // List files in the most recent folder
    const files = await s3Storage.listFolderFiles(mostRecentFolder);
    
    // Look for case.json in the folder
    const caseFileKey = `${mostRecentFolder}/case.json`;
    
    const caseFile = files.find(f => 
      f.name === 'case.json' || 
      f.path?.endsWith('case.json')
    );

    if (!caseFile) {
      return NextResponse.json(
        { message: `case.json not found in ${mostRecentFolder}` },
        { status: 404 }
      );
    }

    // Download the case.json file
    const caseBlob = await s3Storage.downloadFile(caseFileKey);
    
    if (!caseBlob) {
      return NextResponse.json(
        { message: `Failed to download case.json from ${mostRecentFolder}` },
        { status: 500 }
      );
    }

    const caseContent = await caseBlob.text();
    const caseData: SchedulingCase = JSON.parse(caseContent);

    return NextResponse.json(
      { 
        success: true,
        folder: mostRecentFolder,
        case: caseData,
        message: `Successfully fetched configuration from ${mostRecentFolder}`
      },
      { status: 200 }
    );

  } catch (error) {
    console.error('[ERROR] Error fetching last config:', error);
    return NextResponse.json(
      { 
        message: 'Failed to fetch last configuration from S3',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
