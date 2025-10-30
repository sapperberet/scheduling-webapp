"""
AWS Lambda Handler for Scheduling Solver with S3 Storage
=========================================================

This file should be deployed to AWS Lambda alongside your solver code.
It handles both solver operations and S3 storage endpoints.

Environment Variables Required:
    S3_BUCKET: Name of the S3 bucket for storing results (e.g., 'scheduling-solver-results')
    S3_REGION: AWS region (e.g., 'us-east-1')
"""

import json
import boto3
import base64
import re
import os
from datetime import datetime
from typing import Dict, List, Any, Optional
import traceback

# Initialize AWS clients
s3_client = boto3.client('s3')
S3_BUCKET = os.environ.get('S3_BUCKET', 'scheduling-solver-results')
S3_REGION = os.environ.get('S3_REGION', 'us-east-1')

# In-memory storage for run status (use DynamoDB for production)
run_status = {}


def lambda_handler(event, context):
    """
    Main Lambda handler - routes requests to appropriate functions
    """
    try:
        # Parse the event
        path = event.get('path', event.get('rawPath', ''))
        method = event.get('httpMethod', event.get('requestContext', {}).get('http', {}).get('method', 'GET'))
        
        print(f"[LAMBDA] Request: {method} {path}")
        
        # Route to appropriate handler
        if path == '/solve' and method == 'POST':
            return handle_solve(event)
        elif path.startswith('/status/') and method == 'GET':
            run_id = path.split('/')[-1]
            return handle_status(run_id)
        elif path == '/storage/upload-package' and method == 'POST':
            return handle_upload_package(event)
        elif path == '/storage/upload' and method == 'POST':
            return handle_upload_file(event)
        elif path == '/storage/list-folders' and method == 'GET':
            return handle_list_folders()
        elif path.startswith('/storage/list-files/') and method == 'GET':
            folder_name = path.split('/')[-1]
            return handle_list_files(folder_name)
        elif path.startswith('/storage/download/') and method == 'GET':
            # Extract the key from the path (everything after /storage/download/)
            key = path.replace('/storage/download/', '')
            return handle_download_file(key)
        elif path.startswith('/storage/delete-folder/') and method == 'DELETE':
            folder_name = path.split('/')[-1]
            return handle_delete_folder(folder_name)
        elif path == '/health' and method == 'GET':
            return handle_health()
        else:
            return create_response(404, {'error': 'Endpoint not found', 'path': path, 'method': method})
    
    except Exception as e:
        print(f"[ERROR] Lambda handler error: {str(e)}")
        print(traceback.format_exc())
        return create_response(500, {'error': str(e), 'traceback': traceback.format_exc()})


# ============================================================================
# SOLVER ENDPOINTS (Existing)
# ============================================================================

def handle_solve(event):
    """
    Handle solver request - runs optimization and stores results in S3
    """
    try:
        body = json.loads(event.get('body', '{}'))
        run_id = body.get('run_id', f"run_{int(datetime.now().timestamp())}")
        
        print(f"[SOLVE] Starting optimization: {run_id}")
        
        # Update status
        run_status[run_id] = {
            'status': 'processing',
            'progress': 0,
            'message': 'Initializing solver...',
            'started_at': datetime.now().isoformat()
        }
        
        # TODO: Replace with your actual solver logic
        # For now, using a simplified version
        result = run_solver(body, run_id)
        
        # Store results in S3
        folder_name = f"Result_{int(datetime.now().timestamp())}"
        store_results_to_s3(result, folder_name, run_id)
        
        # Update status
        run_status[run_id] = {
            'status': 'completed',
            'progress': 100,
            'message': 'Optimization completed',
            'results': result,
            'output_directory': folder_name,
            'completed_at': datetime.now().isoformat()
        }
        
        return create_response(200, {
            'status': 'completed',
            'run_id': run_id,
            'progress': 100,
            'message': 'Optimization completed',
            'results': result,
            'output_directory': folder_name
        })
    
    except Exception as e:
        print(f"[ERROR] Solve error: {str(e)}")
        return create_response(500, {'error': str(e)})


def handle_status(run_id: str):
    """
    Get status of a running optimization
    """
    if run_id not in run_status:
        return create_response(404, {'error': 'Run not found'})
    
    return create_response(200, run_status[run_id])


def handle_health():
    """
    Health check endpoint
    """
    return create_response(200, {
        'status': 'ok',
        'message': 'AWS Lambda solver is running',
        'timestamp': datetime.now().isoformat(),
        'solver_type': 'aws_lambda',
        's3_bucket': S3_BUCKET,
        'capabilities': ['optimization', 's3_storage', 'progress_tracking']
    })


# ============================================================================
# S3 STORAGE ENDPOINTS (New)
# ============================================================================

def handle_upload_package(event):
    """
    Upload a package of files (Result_N folder) to S3
    
    Request body:
    {
        "folder_name": "Result_5",  // Optional
        "files": {
            "results.json": "base64_content",
            "schedule.xlsx": "base64_content"
        }
    }
    """
    try:
        body = json.loads(event.get('body', '{}'))
        folder_name = body.get('folder_name')
        files = body.get('files', {})
        
        if not files:
            return create_response(400, {'error': 'No files provided'})
        
        # Auto-generate folder name if not provided
        if not folder_name:
            existing_folders = list_s3_folders()
            nums = [int(f.split('_')[1]) for f in existing_folders if re.match(r'Result_\d+', f)]
            next_num = max(nums + [0]) + 1
            folder_name = f'Result_{next_num}'
        
        print(f"[S3] Uploading package to {folder_name}...")
        
        # Upload each file
        uploaded_count = 0
        for filename, base64_content in files.items():
            try:
                # Decode base64 content
                content = base64.b64decode(base64_content)
                key = f'{folder_name}/{filename}'
                
                # Determine content type
                content_type = get_content_type(filename)
                
                # Upload to S3
                s3_client.put_object(
                    Bucket=S3_BUCKET,
                    Key=key,
                    Body=content,
                    ContentType=content_type
                )
                
                uploaded_count += 1
                print(f"[S3] Uploaded {key}")
            
            except Exception as e:
                print(f"[S3] Error uploading {filename}: {str(e)}")
        
        return create_response(200, {
            'success': True,
            'folder_name': folder_name,
            'files_uploaded': uploaded_count
        })
    
    except Exception as e:
        print(f"[ERROR] Upload package error: {str(e)}")
        return create_response(500, {'error': str(e)})


def handle_upload_file(event):
    """
    Upload a single file to S3
    
    Request body:
    {
        "key": "Result_5/results.json",
        "content": "base64_content",
        "contentType": "application/json"
    }
    """
    try:
        body = json.loads(event.get('body', '{}'))
        key = body.get('key')
        base64_content = body.get('content')
        content_type = body.get('contentType', 'application/octet-stream')
        
        if not key or not base64_content:
            return create_response(400, {'error': 'Missing key or content'})
        
        # Decode and upload
        content = base64.b64decode(base64_content)
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=content,
            ContentType=content_type
        )
        
        # Generate URL
        url = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com/{key}"
        
        return create_response(200, {
            'success': True,
            'url': url
        })
    
    except Exception as e:
        print(f"[ERROR] Upload file error: {str(e)}")
        return create_response(500, {'error': str(e)})


def handle_list_folders():
    """
    List all Result_N folders in S3
    """
    try:
        folders = list_s3_folders()
        
        # Sort by number (most recent first)
        sorted_folders = sorted(
            folders,
            key=lambda x: int(x.split('_')[1]) if re.match(r'Result_\d+', x) else 0,
            reverse=True
        )
        
        return create_response(200, {
            'folders': sorted_folders,
            'total': len(sorted_folders)
        })
    
    except Exception as e:
        print(f"[ERROR] List folders error: {str(e)}")
        return create_response(500, {'error': str(e)})


def handle_list_files(folder_name: str):
    """
    List all files in a specific Result_N folder
    """
    try:
        prefix = f'{folder_name}/'
        
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=prefix
        )
        
        files = []
        for obj in response.get('Contents', []):
            key = obj['Key']
            filename = key.replace(prefix, '')
            
            if filename:  # Skip the folder itself
                # Generate presigned URL (valid for 1 hour)
                url = s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': S3_BUCKET, 'Key': key},
                    ExpiresIn=3600
                )
                
                files.append({
                    'name': filename,
                    'path': key,
                    'size': obj['Size'],
                    'lastModified': obj['LastModified'].isoformat(),
                    'url': url
                })
        
        return create_response(200, {
            'files': files,
            'total': len(files)
        })
    
    except Exception as e:
        print(f"[ERROR] List files error: {str(e)}")
        return create_response(500, {'error': str(e)})


def handle_download_file(key: str):
    """
    Download a file from S3
    Returns the file content directly
    """
    try:
        # URL decode the key
        import urllib.parse
        key = urllib.parse.unquote(key)
        
        print(f"[S3] Downloading {key}")
        
        response = s3_client.get_object(
            Bucket=S3_BUCKET,
            Key=key
        )
        
        content = response['Body'].read()
        content_type = response.get('ContentType', 'application/octet-stream')
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': content_type,
                'Access-Control-Allow-Origin': '*'
            },
            'body': base64.b64encode(content).decode('utf-8'),
            'isBase64Encoded': True
        }
    
    except s3_client.exceptions.NoSuchKey:
        return create_response(404, {'error': 'File not found'})
    except Exception as e:
        print(f"[ERROR] Download error: {str(e)}")
        return create_response(500, {'error': str(e)})


def handle_delete_folder(folder_name: str):
    """
    Delete all files in a Result_N folder from S3
    """
    try:
        prefix = f'{folder_name}/'
        
        # List all objects
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=prefix
        )
        
        objects = response.get('Contents', [])
        
        if not objects:
            return create_response(404, {'error': 'Folder not found or already empty'})
        
        # Delete all objects
        delete_keys = [{'Key': obj['Key']} for obj in objects]
        
        s3_client.delete_objects(
            Bucket=S3_BUCKET,
            Delete={'Objects': delete_keys}
        )
        
        print(f"[S3] Deleted {len(delete_keys)} files from {folder_name}")
        
        return create_response(200, {
            'success': True,
            'deleted_count': len(delete_keys)
        })
    
    except Exception as e:
        print(f"[ERROR] Delete folder error: {str(e)}")
        return create_response(500, {'error': str(e)})


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def list_s3_folders() -> List[str]:
    """
    List all Result_N folders in S3 bucket
    """
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix='Result_',
            Delimiter='/'
        )
        
        folders = set()
        
        # Get folders from common prefixes
        for prefix in response.get('CommonPrefixes', []):
            folder = prefix['Prefix'].rstrip('/')
            if re.match(r'Result_\d+', folder):
                folders.add(folder)
        
        # Also check object keys
        for obj in response.get('Contents', []):
            match = re.search(r'(Result_\d+)/', obj['Key'])
            if match:
                folders.add(match.group(1))
        
        return list(folders)
    
    except Exception as e:
        print(f"[ERROR] List folders error: {str(e)}")
        return []


def store_results_to_s3(result: Dict, folder_name: str, run_id: str):
    """
    Store solver results to S3
    """
    try:
        # Store results.json
        results_json = json.dumps(result, indent=2)
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=f'{folder_name}/results.json',
            Body=results_json,
            ContentType='application/json'
        )
        
        print(f"[S3] Stored results to {folder_name}/results.json")
    
    except Exception as e:
        print(f"[ERROR] Failed to store results to S3: {str(e)}")


def run_solver(case_data: Dict, run_id: str) -> Dict:
    """
    Run the actual solver (placeholder - replace with your solver logic)
    """
    # This is a placeholder. Replace with your actual solver from solver_service.py
    # or import your solver module
    
    shifts = case_data.get('shifts', [])
    providers = case_data.get('providers', [])
    
    # Update progress
    run_status[run_id]['progress'] = 25
    run_status[run_id]['message'] = 'Building constraint model...'
    
    # Simple mock assignments
    assignments = []
    for i, shift in enumerate(shifts):
        if i < len(providers):
            provider = providers[i % len(providers)]
            assignments.append({
                'shift_id': shift.get('id'),
                'provider_name': provider.get('name'),
                'date': shift.get('date'),
                'shift_type': shift.get('type')
            })
    
    run_status[run_id]['progress'] = 75
    run_status[run_id]['message'] = 'Finalizing solution...'
    
    return {
        'solutions': [{
            'assignments': assignments,
            'objective_value': 1000
        }],
        'solver_stats': {
            'solver_type': 'ortools_fastapi',
            'status': 'OPTIMAL',
            'execution_time_ms': 2251
        }
    }


def get_content_type(filename: str) -> str:
    """
    Determine content type from filename
    """
    ext = filename.lower().split('.')[-1]
    content_types = {
        'json': 'application/json',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'xls': 'application/vnd.ms-excel',
        'txt': 'text/plain',
        'log': 'text/plain',
        'csv': 'text/csv',
        'pdf': 'application/pdf'
    }
    return content_types.get(ext, 'application/octet-stream')


def create_response(status_code: int, body: Dict) -> Dict:
    """
    Create Lambda response with CORS headers
    """
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        },
        'body': json.dumps(body)
    }
