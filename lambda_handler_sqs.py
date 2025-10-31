"""
AWS Lambda Solver Function - ASYNC SQS VERSION
================================================

This version uses SQS queue for large file support.

Key Features:
- SQS queue for handling 60KB-200KB+ cases without timeout
- Real solver via testcase_gui.Solve_test_case()
- Proper progress tracking (0% → 100%)
- Correct Result_N numbering from S3
- Full file output generation
- No 29-second API Gateway timeout

Environment Variables Required:
    S3_RESULTS_BUCKET: S3 bucket for results
    AWS_REGION: AWS region
    SOLVER_QUEUE_URL: SQS queue URL for solver tasks
"""

import json
import logging
import os
import uuid
import re
from datetime import datetime
from typing import Dict, Any, List, Optional
import tempfile
import boto3

try:
    from fastapi import FastAPI, HTTPException, BackgroundTasks
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    from mangum import Mangum
except ImportError:
    print("Please install: pip install fastapi mangum boto3 ortools python-multipart")
    raise

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aws-lambda-solver-sqs")

app = FastAPI(title="AWS Lambda Scheduling Solver (SQS)")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AWS Configuration
S3_BUCKET = os.environ.get('S3_RESULTS_BUCKET', 'scheduling-solver-results')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
QUEUE_URL = os.environ.get('SOLVER_QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/433864970068/scheduling-solver-queue')

# Initialize AWS clients
s3_client = boto3.client('s3', region_name=AWS_REGION)
sqs_client = boto3.client('sqs', region_name=AWS_REGION)

# Global state (in production, use DynamoDB)
active_runs: Dict[str, Dict[str, Any]] = {}

# Pydantic models
class SchedulingCase(BaseModel):
    constants: Dict[str, Any]
    calendar: Dict[str, Any]
    shifts: List[Dict[str, Any]]
    providers: List[Dict[str, Any]]
    run: Optional[Dict[str, Any]] = None

# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.post("/solve")
async def solve(case: SchedulingCase):
    """
    Queue optimization (async - returns immediately)
    
    NEW: Uses SQS queue to handle large files without API Gateway timeout
    """
    try:
        run_id = str(uuid.uuid4())
        
        # Initialize run state  
        active_runs[run_id] = {
            "status": "queued",
            "progress": 0,
            "message": "Case queued for processing",
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # Queue the case to SQS
        message_body = {
            "run_id": run_id,
            "case": case.dict(),
            "created_at": datetime.utcnow().isoformat()
        }
        
        response = sqs_client.send_message(
            QueueUrl=QUEUE_URL,
            MessageBody=json.dumps(message_body),
            MessageAttributes={
                'run_id': {
                    'StringValue': run_id,
                    'DataType': 'String'
                }
            }
        )
        
        logger.info(f"[SOLVE] Queued optimization run: {run_id} (Message: {response['MessageId']})")
        
        return {
            "run_id": run_id,
            "status": "queued",
            "progress": 0,
            "message": "Case queued for processing. Check /status/{run_id} for progress"
        }
        
    except Exception as e:
        logger.error(f"[ERROR] Failed to queue optimization: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/status/{run_id}")
async def get_status(run_id: str):
    """Get optimization status and progress"""
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail="Run not found")
    
    run_data = active_runs[run_id]
    
    response = {
        "status": run_data["status"],
        "message": run_data["message"],
        "run_id": run_id,
        "progress": run_data.get("progress", 0)
    }
    
    if run_data["status"] == "completed":
        response["results"] = run_data.get("result")
        response["output_directory"] = run_data.get("output_directory")
    
    if run_data["status"] == "failed":
        response["error"] = run_data.get("error", "Unknown error")
    
    return response


@app.get("/results/folders")
async def list_result_folders():
    """List all Result_N folders in S3 with file info, runtime, providers, and shifts"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Delimiter='/'
        )
        
        folders = []
        for prefix in response.get('CommonPrefixes', []):
            folder_name = prefix['Prefix'].rstrip('/')
            
            try:
                # Get metadata
                metadata_key = f"{folder_name}/metadata.json"
                obj = s3_client.get_object(Bucket=S3_BUCKET, Key=metadata_key)
                metadata = json.loads(obj['Body'].read())
                
                # Get file count and size
                files_response = s3_client.list_objects_v2(
                    Bucket=S3_BUCKET,
                    Prefix=f"{folder_name}/"
                )
                
                file_count = 0
                total_size = 0
                scheduler_log_key = None
                run_log_key = None
                
                for file_obj in files_response.get('Contents', []):
                    key = file_obj['Key']
                    if key != f"{folder_name}/":
                        file_count += 1
                        total_size += file_obj['Size']
                        # Find scheduler_log_*.json file (may be nested under case name)
                        if 'scheduler_log_' in key and key.endswith('.json'):
                            scheduler_log_key = key
                        # Find scheduler_run.log file (may be nested under case name)
                        if 'scheduler_run.log' in key:
                            run_log_key = key
                
                # Extract runtime from scheduler_log JSON
                runtime_seconds = 0.0
                if scheduler_log_key:
                    try:
                        obj = s3_client.get_object(Bucket=S3_BUCKET, Key=scheduler_log_key)
                        sched_meta = json.loads(obj['Body'].read())
                        # Sum phase1 and phase2 wall times
                        phase1_time = sched_meta.get('phase1', {}).get('per_table', [{}])[0].get('wall_time_s', 0)
                        phase2_time = sched_meta.get('phase2', {}).get('per_table', [{}])[0].get('wall_time_s', 0)
                        runtime_seconds = float(phase1_time) + float(phase2_time)
                        logger.info(f"[METRICS] Extracted runtime {runtime_seconds:.2f}s from {scheduler_log_key}")
                    except Exception as e:
                        logger.warning(f"[WARN] Could not extract runtime from {scheduler_log_key}: {e}")
                
                # Extract providers and shifts from scheduler_run.log
                providers_count = 0
                shifts_count = 0
                if run_log_key:
                    try:
                        obj = s3_client.get_object(Bucket=S3_BUCKET, Key=run_log_key)
                        log_content = obj['Body'].read().decode('utf-8')
                        # Parse "Loaded case with 31 days, 36 shifts, 11 providers"
                        match = re.search(r'Loaded case with (\d+) days, (\d+) shifts, (\d+) providers', log_content)
                        if match:
                            shifts_count = int(match.group(2))
                            providers_count = int(match.group(3))
                            logger.info(f"[METRICS] Extracted {providers_count} providers, {shifts_count} shifts from {run_log_key}")
                        else:
                            logger.warning(f"[WARN] Could not parse pattern from {run_log_key}")
                    except Exception as e:
                        logger.warning(f"[WARN] Could not extract problem size from {run_log_key}: {e}")
                
                folders.append({
                    'name': folder_name,
                    'created': metadata.get('created_at'),
                    'solver_type': metadata.get('solver_type', 'aws_lambda'),
                    'solutions_count': metadata.get('solutions_count', 0),
                    'file_count': file_count,
                    'total_size': total_size,
                    'runtime_seconds': round(runtime_seconds, 2),
                    'providers': providers_count,
                    'shifts': shifts_count
                })
            except Exception as e:
                logger.warning(f"[WARN] Error getting info for {folder_name}: {e}")
                folders.append({
                    'name': folder_name,
                    'created': datetime.utcnow().isoformat(),
                    'solver_type': 'aws_lambda',
                    'solutions_count': 0,
                    'file_count': 0,
                    'total_size': 0,
                    'runtime_seconds': 0.0,
                    'providers': 0,
                    'shifts': 0
                })
        
        folders.sort(key=lambda x: x['name'], reverse=True)
        return {"folders": folders}
        
    except Exception as e:
        logger.error(f"[ERROR] Error listing folders: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download/folder/{folder_name}")
async def download_folder(folder_name: str):
    """Download a result folder as ZIP from S3"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=f"{folder_name}/"
        )
        
        if 'Contents' not in response:
            raise HTTPException(status_code=404, detail="Folder not found")
        
        import zipfile
        import io
        
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for obj in response['Contents']:
                key = obj['Key']
                filename = key.replace(f"{folder_name}/", "")
                
                if filename:
                    file_obj = s3_client.get_object(Bucket=S3_BUCKET, Key=key)
                    file_content = file_obj['Body'].read()
                    zip_file.writestr(filename, file_content)
        
        from fastapi.responses import Response
        
        zip_buffer.seek(0)
        return Response(
            content=zip_buffer.read(),
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={folder_name}.zip"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ERROR] Error downloading folder: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/results/delete/{folder_name}")
async def delete_results(folder_name: str):
    """Delete a result folder from S3"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=f"{folder_name}/"
        )
        
        if 'Contents' not in response or len(response.get('Contents', [])) == 0:
            raise HTTPException(status_code=404, detail="Folder not found")
        
        for obj in response['Contents']:
            s3_client.delete_object(Bucket=S3_BUCKET, Key=obj['Key'])
        
        logger.info(f"[DELETE] Deleted folder: {folder_name}")
        return {"status": "deleted", "folder": folder_name}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ERROR] Error deleting folder: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "message": "AWS Lambda Solver is running",
        "timestamp": datetime.utcnow().isoformat(),
        "solver": "real_ortools",
        "mode": "sqs_async",
        "s3_bucket": S3_BUCKET,
        "region": AWS_REGION
    }


# ============================================================================
# Lambda Handler
# ============================================================================

# Create the Mangum adapter for HTTP requests with explicit API Gateway v2 format support
handler = Mangum(
    app,
    lifespan="off",  # Disable ASGI lifespan for Lambda
)

