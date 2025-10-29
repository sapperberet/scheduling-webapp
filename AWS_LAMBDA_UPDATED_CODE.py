"""
AWS Lambda Solver Function - UPDATED VERSION
Async execution with progress tracking and S3 storage

Deploy this to your AWS Lambda to fix all cloud solver issues:
1. Progress tracking (0% → 100%)
2. Proper S3 storage
3. Correct result numbering
4. Persistent timestamps

Requirements:
- FastAPI
- Mangum (for AWS Lambda adapter)
- boto3 (AWS SDK)
- ortools
"""

import json
import logging
import os
import uuid
import re
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path
import tempfile

try:
    from fastapi import FastAPI, HTTPException, BackgroundTasks
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    from mangum import Mangum
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    print("Please install: pip install fastapi mangum boto3 ortools python-multipart")
    raise

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aws-lambda-solver")

app = FastAPI(title="AWS Lambda Scheduling Solver")

# CORS for your Next.js app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AWS S3 Configuration
S3_BUCKET = os.environ.get('S3_RESULTS_BUCKET', 'scheduling-solver-results')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Initialize S3 client
s3_client = boto3.client('s3', region_name=AWS_REGION)

# Global state for active runs (in production, use DynamoDB or Redis)
active_runs: Dict[str, Dict[str, Any]] = {}

# Pydantic models
class SchedulingCase(BaseModel):
    constants: Dict[str, Any]
    calendar: Dict[str, Any]
    shifts: List[Dict[str, Any]]
    providers: List[Dict[str, Any]]
    run: Optional[Dict[str, Any]] = None

class SolverStatus(BaseModel):
    status: str
    message: str
    run_id: str
    progress: int
    results: Optional[Dict[str, Any]] = None
    output_directory: Optional[str] = None

# Progress tracking helper
def update_progress(run_id: str, progress: int, message: str):
    """Update progress - only moves forward"""
    if run_id in active_runs:
        current = active_runs[run_id].get('progress', 0)
        if progress > current:
            active_runs[run_id]['progress'] = progress
            active_runs[run_id]['message'] = message
            active_runs[run_id]['updated_at'] = datetime.utcnow().isoformat()
            logger.info(f"Run {run_id}: {progress}% - {message}")

# S3 Helper Functions
def get_next_result_number() -> int:
    """Get next available Result_N number from S3"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Delimiter='/'
        )
        
        max_num = 0
        for prefix in response.get('CommonPrefixes', []):
            folder = prefix['Prefix'].rstrip('/')
            match = re.match(r'Result_(\d+)', folder)
            if match:
                num = int(match.group(1))
                if num > max_num:
                    max_num = num
        
        return max_num + 1
    except Exception as e:
        logger.error(f"Error getting next result number: {e}")
        return 1

def upload_results_to_s3(run_id: str, result_data: Dict[str, Any]) -> str:
    """Upload results to S3 and return folder name"""
    try:
        # Generate folder name
        folder_name = f"Result_{get_next_result_number()}"
        
        # Upload results.json
        results_key = f"{folder_name}/results.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=results_key,
            Body=json.dumps(result_data, indent=2),
            ContentType='application/json',
            Metadata={
                'run-id': run_id,
                'created-at': datetime.utcnow().isoformat(),
                'solver-type': 'aws_lambda'
            }
        )
        
        # Upload metadata.json
        metadata = {
            'run_id': run_id,
            'created_at': datetime.utcnow().isoformat(),
            'solver_type': 'aws_lambda',
            'solutions_count': len(result_data.get('solutions', [])),
            'folder_name': folder_name
        }
        
        metadata_key = f"{folder_name}/metadata.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=metadata_key,
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        
        logger.info(f"Uploaded results to S3: {folder_name}")
        return folder_name
        
    except Exception as e:
        logger.error(f"Failed to upload to S3: {e}")
        raise

# Background optimization task
async def run_optimization(case_data: Dict[str, Any], run_id: str):
    """Background task for running optimization"""
    try:
        active_runs[run_id]["status"] = "running"
        update_progress(run_id, 2, "Validating input...")
        
        # Import your actual solver logic here
        # For now, using placeholder
        from your_solver_module import solve_scheduling_case
        
        update_progress(run_id, 10, "Preparing optimization model...")
        
        # Run the actual solver
        result = solve_scheduling_case(case_data, run_id, update_progress)
        
        update_progress(run_id, 90, "Uploading results to S3...")
        
        # Upload to S3
        folder_name = upload_results_to_s3(run_id, result)
        
        update_progress(run_id, 95, "Finalizing...")
        
        # Update active_runs with completion
        active_runs[run_id].update({
            "status": "completed",
            "progress": 100,
            "message": "Optimization completed successfully",
            "result": result,
            "output_directory": folder_name,
            "completed_at": datetime.utcnow().isoformat()
        })
        
        logger.info(f"Run {run_id} completed successfully")
        
    except Exception as e:
        logger.error(f"Optimization failed for run {run_id}: {e}")
        active_runs[run_id].update({
            "status": "failed",
            "progress": -1,
            "message": str(e),
            "error": str(e),
            "completed_at": datetime.utcnow().isoformat()
        })

# API Endpoints

@app.post("/solve")
async def solve(case: SchedulingCase, background_tasks: BackgroundTasks):
    """
    Start optimization (async - returns immediately)
    
    Returns:
        {
            "run_id": "abc-123",
            "status": "processing",
            "progress": 0,
            "message": "Optimization started"
        }
    """
    try:
        run_id = str(uuid.uuid4())
        
        # Initialize run state
        active_runs[run_id] = {
            "status": "processing",
            "progress": 0,
            "message": "Optimization started",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # Start background task
        background_tasks.add_task(run_optimization, case.dict(), run_id)
        
        logger.info(f"Started optimization run: {run_id}")
        
        # Return immediately
        return {
            "run_id": run_id,
            "status": "processing",
            "progress": 0,
            "message": "Optimization started"
        }
        
    except Exception as e:
        logger.error(f"Failed to start optimization: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/status/{run_id}")
async def get_status(run_id: str):
    """
    Get optimization status and progress
    
    Returns:
        {
            "status": "processing|completed|failed",
            "progress": 0-100,
            "message": "Current status message",
            "results": {...},  // Only when completed
            "output_directory": "Result_N"  // Only when completed
        }
    """
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail="Run not found")
    
    run_data = active_runs[run_id]
    
    response = {
        "status": run_data["status"],
        "message": run_data["message"],
        "run_id": run_id,
        "progress": run_data.get("progress", 0)
    }
    
    # Include full results when completed
    if run_data["status"] == "completed":
        response["results"] = run_data.get("result")
        response["output_directory"] = run_data.get("output_directory")
    
    # Include error details if failed
    if run_data["status"] == "failed":
        response["error"] = run_data.get("error", "Unknown error")
    
    return response

@app.get("/results/folders")
async def list_result_folders():
    """List all Result_N folders in S3"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Delimiter='/'
        )
        
        folders = []
        for prefix in response.get('CommonPrefixes', []):
            folder_name = prefix['Prefix'].rstrip('/')
            
            # Get folder metadata
            try:
                metadata_key = f"{folder_name}/metadata.json"
                obj = s3_client.get_object(Bucket=S3_BUCKET, Key=metadata_key)
                metadata = json.loads(obj['Body'].read())
                
                folders.append({
                    'name': folder_name,
                    'created': metadata.get('created_at'),
                    'solver_type': metadata.get('solver_type', 'aws_lambda'),
                    'solutions_count': metadata.get('solutions_count', 0)
                })
            except:
                # Fallback if no metadata
                folders.append({
                    'name': folder_name,
                    'created': datetime.utcnow().isoformat(),
                    'solver_type': 'aws_lambda',
                    'solutions_count': 0
                })
        
        # Sort by name (newest first)
        folders.sort(key=lambda x: x['name'], reverse=True)
        
        return {"folders": folders}
        
    except Exception as e:
        logger.error(f"Error listing folders: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/download/folder/{folder_name}")
async def download_folder(folder_name: str):
    """Download a Result_N folder as ZIP from S3"""
    try:
        # List all files in folder
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=f"{folder_name}/"
        )
        
        if 'Contents' not in response:
            raise HTTPException(status_code=404, detail="Folder not found")
        
        # Create ZIP in memory
        import zipfile
        import io
        
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for obj in response['Contents']:
                key = obj['Key']
                filename = key.replace(f"{folder_name}/", "")
                
                if filename:  # Skip folder itself
                    # Download from S3
                    file_obj = s3_client.get_object(Bucket=S3_BUCKET, Key=key)
                    file_content = file_obj['Body'].read()
                    
                    # Add to ZIP
                    zip_file.writestr(filename, file_content)
        
        # Return ZIP
        from fastapi.responses import Response
        
        zip_buffer.seek(0)
        return Response(
            content=zip_buffer.read(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={folder_name}.zip"
            }
        )
        
    except Exception as e:
        logger.error(f"Error downloading folder: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "AWS Lambda Solver is running",
        "timestamp": datetime.utcnow().isoformat(),
        "active_runs": len(active_runs),
        "s3_bucket": S3_BUCKET,
        "region": AWS_REGION
    }

@app.get("/")
async def root():
    """API information"""
    return {
        "title": "AWS Lambda Scheduling Solver",
        "version": "2.0.0",
        "endpoints": {
            "POST /solve": "Start optimization (async)",
            "GET /status/{run_id}": "Get optimization progress",
            "GET /results/folders": "List all result folders",
            "GET /download/folder/{folder_name}": "Download results as ZIP",
            "GET /health": "Health check"
        },
        "storage": "AWS S3",
        "execution": "Async with progress tracking"
    }

# AWS Lambda handler (using Mangum)
handler = Mangum(app)

# For local testing
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
