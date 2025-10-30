/**
 * Results Management API
 * 
 * List all Result_N folders stored on AWS S3
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, createAuthResponse } from '@/lib/auth';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

export async function GET(request: NextRequest) {
  // Verify authentication
  const token = await verifyAuth(request);
  if (!token) {
    return createAuthResponse('Authentication required');
  }

  try {
    // Use AWS SDK directly to list S3 folders
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });

    const bucket = process.env.AWS_S3_BUCKET || 'scheduling-solver-results';

    // List all Result_N folders
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Delimiter: '/',
      })
    );

    const folderPrefixes = response.CommonPrefixes || [];
    const folders = folderPrefixes.map((p) => p.Prefix?.replace('/', '') || '');

    console.log(`[RESULTS] Found ${folders.length} folders in AWS S3`);

    // Get metadata for each folder
    const foldersWithMetadata = await Promise.all(
      folders.map(async (folderName) => {
        try {
          // List files in this folder from S3
          const filesResponse = await s3Client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: `${folderName}/`,
            })
          );

          const files = filesResponse.Contents || [];

          let metadata = {
            solutions: 0,
            solver_type: 'unknown',
            execution_time: 0,
          };

          // Try to get metadata from metadata.json or results.json
          const metadataFile = files.find((f) => f.Key?.endsWith('metadata.json'));

          if (metadataFile && metadataFile.Key) {
            try {
              const { GetObjectCommand } = await import('@aws-sdk/client-s3');
              const obj = await s3Client.send(
                new GetObjectCommand({
                  Bucket: bucket,
                  Key: metadataFile.Key,
                })
              );

              if (obj.Body) {
                const content = await obj.Body.transformToString();
                const metadataData = JSON.parse(content);
                metadata = {
                  solutions: metadataData.solutions_count || 0,
                  solver_type: metadataData.solver_type || 'aws_lambda',
                  execution_time: metadataData.execution_time || 0,
                };
              }
            } catch (err) {
              console.warn(`[RESULTS] Could not fetch metadata for ${folderName}:`, err);
            }
          }

          return {
            name: folderName,
            fileCount: files.length,
            size: files.reduce((sum, f) => sum + (f.Size || 0), 0),
            created: (files[0]?.LastModified || new Date()).toISOString(),
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
            solutions: 0,
            solver_type: 'unknown',
          };
        }
      })
    );

    // Sort by folder name (most recent first)
    const sorted = foldersWithMetadata.sort((a, b) => {
      const numA = parseInt(a.name.replace('Result_', ''));
      const numB = parseInt(b.name.replace('Result_', ''));
      return numB - numA;
    });

    return NextResponse.json({
      success: true,
      folders: sorted,
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
