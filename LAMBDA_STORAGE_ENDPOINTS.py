"""
AWS Lambda Storage Endpoints Reference
=======================================

These endpoints need to be implemented in your AWS Lambda function to support
the webapp's AWS S3 storage operations.

Base URL: https://your-lambda-url.execute-api.us-east-1.amazonaws.com
"""

# 1. Upload Single File to S3
"""
POST /storage/upload

Request Body:
{
    "key": "Result_1/results.json",
    "content": "base64_encoded_content_here",
    "contentType": "application/json",
    "metadata": {
        "solver_type": "ortools",
        "timestamp": "2025-10-29T16:56:28Z"
    }
}

Response (200):
{
    "success": true,
    "url": "https://s3.amazonaws.com/bucket/Result_1/results.json"
}

Response (500):
{
    "success": false,
    "error": "Upload failed: permission denied"
}
"""

# 2. Upload Package (Multiple Files as Folder)
"""
POST /storage/upload-package

Request Body:
{
    "folder_name": "Result_5",  // Optional - will auto-generate if not provided
    "files": {
        "results.json": "base64_content_here",
        "schedule.xlsx": "base64_content_here",
        "logs.txt": "base64_content_here"
    }
}

Response (200):
{
    "success": true,
    "folder_name": "Result_5",
    "files_uploaded": 3
}

Implementation Notes:
- If folder_name not provided, generate next available Result_N
- Upload all files to S3 with prefix: {bucket}/Result_N/{filename}
- Decode base64 content before uploading
"""

# 3. List All Result Folders
"""
GET /storage/list-folders

Response (200):
{
    "folders": ["Result_1", "Result_2", "Result_3", "Result_5"],
    "total": 4
}

Implementation Notes:
- List all objects in S3 bucket
- Extract unique folder names matching pattern "Result_\d+"
- Return sorted by number (descending)

Python Example:
```python
import boto3
import re

s3 = boto3.client('s3')
response = s3.list_objects_v2(Bucket='scheduling-solver-results', Prefix='Result_')

folders = set()
for obj in response.get('Contents', []):
    match = re.search(r'(Result_\d+)/', obj['Key'])
    if match:
        folders.add(match.group(1))

return {
    'folders': sorted(folders, key=lambda x: int(x.split('_')[1]), reverse=True),
    'total': len(folders)
}
```
"""

# 4. List Files in a Folder
"""
GET /storage/list-files/{folderName}

Example: GET /storage/list-files/Result_5

Response (200):
{
    "files": [
        {
            "name": "results.json",
            "path": "Result_5/results.json",
            "size": 15234,
            "lastModified": "2025-10-29T16:56:28.000Z",
            "url": "https://presigned-url-here"  // Optional presigned URL
        },
        {
            "name": "schedule.xlsx",
            "path": "Result_5/schedule.xlsx",
            "size": 45678,
            "lastModified": "2025-10-29T16:56:28.000Z"
        }
    ],
    "total": 2
}

Implementation Notes:
- List objects with prefix: {folderName}/
- Return file metadata for each object
- Optionally generate presigned URLs (valid for 1 hour)
"""

# 5. Download File from S3
"""
GET /storage/download/{key}

Example: GET /storage/download/Result_5%2Fresults.json

Response (200):
- Content-Type: Inferred from file extension
- Body: File content (binary)

Response (404):
{
    "error": "File not found"
}

Implementation Notes:
- URL-decode the key parameter
- Get object from S3
- Stream content directly to response
- Set appropriate Content-Type header
"""

# 6. Delete Folder
"""
DELETE /storage/delete-folder/{folderName}

Example: DELETE /storage/delete-folder/Result_5

Response (200):
{
    "success": true,
    "deleted_count": 3
}

Response (500):
{
    "success": false,
    "error": "Failed to delete: access denied"
}

Implementation Notes:
- List all objects with prefix: {folderName}/
- Delete all objects in batch (max 1000 per batch)
- Return count of deleted objects

Python Example:
```python
s3 = boto3.client('s3')
bucket = 'scheduling-solver-results'
prefix = f'{folder_name}/'

# List objects
response = s3.list_objects_v2(Bucket=bucket, Prefix=prefix)
objects = response.get('Contents', [])

if not objects:
    return {'success': False, 'error': 'Folder not found'}

# Delete objects
delete_keys = [{'Key': obj['Key']} for obj in objects]
s3.delete_objects(
    Bucket=bucket,
    Delete={'Objects': delete_keys}
)

return {
    'success': True,
    'deleted_count': len(delete_keys)
}
```
"""

# 7. Get Presigned URL (Optional)
"""
POST /storage/presigned-url

Request Body:
{
    "key": "Result_5/results.json",
    "expires_in": 3600  // seconds, default 3600 (1 hour)
}

Response (200):
{
    "url": "https://s3.amazonaws.com/bucket/Result_5/results.json?AWSAccessKeyId=..."
}

Implementation Notes:
- Generate presigned URL for GET operation
- URL expires after specified time
- Allows temporary public access to private files
"""

# ============================================================================
# S3 Bucket Configuration
# ============================================================================
"""
Recommended S3 Bucket Settings:

1. Bucket Name: scheduling-solver-results
2. Region: us-east-1 (same as Lambda for low latency)
3. Versioning: Disabled (not needed for solver results)
4. Public Access: Blocked (use presigned URLs)
5. Encryption: AES-256 (S3 managed keys)
6. Lifecycle Rules:
   - Delete objects older than 90 days (optional, for cost savings)
   - Transition to Glacier after 30 days (optional)

CORS Configuration (if needed for direct browser uploads):
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
        "AllowedOrigins": ["https://mlsched.com"],
        "ExposeHeaders": ["ETag"]
    }
]

Bucket Policy (Lambda access):
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "lambda.amazonaws.com"
            },
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::scheduling-solver-results",
                "arn:aws:s3:::scheduling-solver-results/*"
            ]
        }
    ]
}
"""

# ============================================================================
# Lambda IAM Role Permissions
# ============================================================================
"""
The Lambda function needs these permissions in its execution role:

{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::scheduling-solver-results",
                "arn:aws:s3:::scheduling-solver-results/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        }
    ]
}
"""

# ============================================================================
# Environment Variables for Lambda
# ============================================================================
"""
Set these environment variables in your Lambda function:

S3_BUCKET=scheduling-solver-results
S3_REGION=us-east-1
RESULTS_PREFIX=  # Empty or "solver_output/" if you want a prefix
"""

# ============================================================================
# Python Lambda Handler Example
# ============================================================================
"""
import json
import boto3
import base64
import re
from datetime import datetime
from typing import Dict, List, Any

s3 = boto3.client('s3')
BUCKET = 'scheduling-solver-results'

def lambda_handler(event, context):
    path = event.get('path', '')
    method = event.get('httpMethod', 'GET')
    
    # Route requests
    if path.startswith('/storage/upload-package') and method == 'POST':
        return upload_package(event)
    elif path.startswith('/storage/upload') and method == 'POST':
        return upload_file(event)
    elif path.startswith('/storage/list-folders') and method == 'GET':
        return list_folders()
    elif path.startswith('/storage/list-files/') and method == 'GET':
        folder_name = path.split('/')[-1]
        return list_files(folder_name)
    elif path.startswith('/storage/download/') and method == 'GET':
        key = path.replace('/storage/download/', '')
        return download_file(key)
    elif path.startswith('/storage/delete-folder/') and method == 'DELETE':
        folder_name = path.split('/')[-1]
        return delete_folder(folder_name)
    
    return {
        'statusCode': 404,
        'body': json.dumps({'error': 'Endpoint not found'})
    }

def upload_package(event):
    body = json.loads(event.get('body', '{}'))
    folder_name = body.get('folder_name')
    files = body.get('files', {})
    
    # Auto-generate folder name if not provided
    if not folder_name:
        existing = list_folders()
        nums = [int(f.split('_')[1]) for f in existing.get('folders', [])]
        next_num = max(nums + [0]) + 1
        folder_name = f'Result_{next_num}'
    
    # Upload each file
    uploaded = 0
    for filename, base64_content in files.items():
        try:
            content = base64.b64decode(base64_content)
            key = f'{folder_name}/{filename}'
            s3.put_object(Bucket=BUCKET, Key=key, Body=content)
            uploaded += 1
        except Exception as e:
            print(f'Error uploading {filename}: {e}')
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'success': True,
            'folder_name': folder_name,
            'files_uploaded': uploaded
        })
    }

def list_folders():
    response = s3.list_objects_v2(Bucket=BUCKET, Prefix='Result_')
    folders = set()
    
    for obj in response.get('Contents', []):
        match = re.search(r'(Result_\d+)/', obj['Key'])
        if match:
            folders.add(match.group(1))
    
    sorted_folders = sorted(folders, key=lambda x: int(x.split('_')[1]), reverse=True)
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'folders': sorted_folders,
            'total': len(sorted_folders)
        })
    }

# ... implement other functions similarly
"""
