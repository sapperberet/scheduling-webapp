/**
 * Results Management API
 * 
 * List all Result_N folders stored on AWS S3
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, createAuthResponse } from '@/lib/auth';
import { createAWSS3Storage } from '@/lib/aws-s3-storage';

export async function GET(request: NextRequest) {
  // Verify authentication
  const token = await verifyAuth(request);
  if (!token) {
    return createAuthResponse('Authentication required');
  }

  try {
    // Get AWS S3 storage client
    const s3Storage = createAWSS3Storage();
    
    if (!s3Storage) {
      console.warn('[RESULTS] AWS S3 not configured');
      return NextResponse.json({
        success: true,
        folders: [],
        total: 0,
        warning: 'AWS S3 not configured',
      });
    }

    // List all Result_N folders from AWS S3
    const awsFolders = await s3Storage.listResultFolders();
    
    console.log(`[RESULTS] Found ${awsFolders.length} folders in AWS S3`);
    
    // Sort by number (most recent first)
    const folders = awsFolders.sort((a, b) => {
      const numA = parseInt(a.replace('Result_', ''));
      const numB = parseInt(b.replace('Result_', ''));
      return numB - numA;
    });

    // Get metadata for each folder
    const foldersWithMetadata = await Promise.all(
      folders.map(async (folderName) => {
        try {
          // List files in this folder from S3
          const files = await s3Storage.listFolderFiles(folderName);
          
          // Try to get results.json for metadata
          const resultsFile = files.find(f => f.name.endsWith('results.json'));
          let metadata = {};
          
          if (resultsFile && resultsFile.url) {
            try {
              const response = await fetch(resultsFile.url);
              const resultsData = await response.json();
              metadata = {
                solutions: resultsData.solutions?.length || 0,
                solver_type: resultsData.solver_stats?.solver_type || 'unknown',
                execution_time: resultsData.solver_stats?.execution_time_ms || 0,
              };
            } catch (err) {
              console.warn(`[RESULTS] Could not fetch metadata for ${folderName}:`, err);
            }
          }

          return {
            name: folderName,
            fileCount: files.length,
            size: files.reduce((sum, f) => sum + f.size, 0),
            created: files[0]?.lastModified?.toISOString() || new Date().toISOString(),
            storage: 'aws_s3',
            ...metadata,
          };
        } catch (err) {
          console.error(`[RESULTS] Error processing folder ${folderName}:`, err);
          return {
            name: folderName,
            fileCount: 0,
            size: 0,
            created: new Date().toISOString(),
            storage: 'aws_s3',
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      folders: foldersWithMetadata,
      total: folders.length,
      storage: 'aws_s3',
    });

  } catch (error) {
    console.error('[RESULTS] Error listing results:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        folders: [],
        total: 0,
      },
      { status: 500 }
    );
  }
}
