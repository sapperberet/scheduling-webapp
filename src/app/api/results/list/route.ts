/**
 * Results Management API
 * 
 * List all Result_N folders stored on the server (AWS S3 or Vercel Blob)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, createAuthResponse } from '@/lib/auth';
import { list } from '@vercel/blob';

export async function GET(request: NextRequest) {
  // Verify authentication
  const token = await verifyAuth(request);
  if (!token) {
    return createAuthResponse('Authentication required');
  }

  try {
    // List all Result_N folders from Vercel Blob
    const { blobs } = await list({ prefix: 'solver_output/Result_' });
    
    // Also check AWS results if configured
    const awsResults = await listAWSResults();
    
    // Extract unique folder names
    const folderSet = new Set<string>();
    
    // From Vercel Blob
    blobs.forEach(blob => {
      const match = blob.pathname.match(/^solver_output\/(Result_\d+)\//);
      if (match) {
        folderSet.add(match[1]);
      }
    });

    // From AWS (merged with local)
    awsResults.forEach(folder => folderSet.add(folder));
    
    // Convert to array and sort by number
    const folders = Array.from(folderSet).sort((a, b) => {
      const numA = parseInt(a.replace('Result_', ''));
      const numB = parseInt(b.replace('Result_', ''));
      return numB - numA; // Most recent first
    });

    // Get metadata for each folder
    const foldersWithMetadata = await Promise.all(
      folders.map(async (folderName) => {
        try {
          const files = blobs.filter(blob => 
            blob.pathname.startsWith(`solver_output/${folderName}/`)
          );

          // Try to get results.json for metadata
          const resultsBlob = files.find(f => f.pathname.endsWith('/results.json'));
          let metadata = {};
          
          if (resultsBlob) {
            try {
              const response = await fetch(resultsBlob.url);
              const resultsData = await response.json();
              metadata = {
                solutions: resultsData.solutions?.length || 0,
                solver_type: resultsData.solver_stats?.solver_type || 'unknown',
                execution_time: resultsData.solver_stats?.execution_time_ms || 0,
              };
            } catch {
              // Ignore metadata errors
            }
          }

          return {
            name: folderName,
            fileCount: files.length,
            size: files.reduce((sum, f) => sum + f.size, 0),
            created: files[0]?.uploadedAt || new Date().toISOString(),
            storage: files.length > 0 ? 'vercel' : 'aws',
            ...metadata,
          };
        } catch {
          return {
            name: folderName,
            fileCount: 0,
            size: 0,
            created: new Date().toISOString(),
            storage: 'aws',
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      folders: foldersWithMetadata,
      total: folders.length,
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

// Helper function to list AWS S3 results (if configured)
async function listAWSResults(): Promise<string[]> {
  try {
    const AWS_LAMBDA_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
    if (!AWS_LAMBDA_URL) {
      return [];
    }

    // The AWS Lambda uses /runs endpoint, not /results/folders
    // We need to get runs and extract their output directories
    const response = await fetch(`${AWS_LAMBDA_URL}/runs`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    // Extract folder names from runs that have output directories
    const folders: string[] = [];
    if (data.runs && Array.isArray(data.runs)) {
      data.runs.forEach((run: { output_directory?: string }) => {
        if (run.output_directory) {
          // Extract Result_N from output_directory path
          const match = run.output_directory.match(/Result_\d+/);
          if (match && !folders.includes(match[0])) {
            folders.push(match[0]);
          }
        }
      });
    }
    return folders;
  } catch {
    // AWS not available, return empty
    return [];
  }
}
