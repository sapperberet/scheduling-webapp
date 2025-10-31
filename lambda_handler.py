"""
AWS Lambda Solver Function - REAL SOLVER VERSION
================================================

This is the CORRECT AWS Lambda handler that integrates with the real testcase_gui solver.

Key Features:
- Real solver via testcase_gui.Solve_test_case()
- Proper progress tracking (0% → 100%)
- Correct Result_N numbering from S3
- Full file output generation
- Persistent timestamps
- Async execution with background tasks

Environment Variables Required:
    S3_RESULTS_BUCKET: S3 bucket for results (e.g., 'scheduling-solver-results')
    AWS_REGION: AWS region (e.g., 'us-east-1')
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

# ============================================================================
# PROGRESS TRACKING & S3 HELPERS
# ============================================================================

def update_progress(run_id: str, progress: int, message: str):
    """Update progress - only moves forward"""
    if run_id in active_runs:
        current = active_runs[run_id].get('progress', 0)
        if progress > current:
            active_runs[run_id]['progress'] = progress
            active_runs[run_id]['message'] = message
            active_runs[run_id]['updated_at'] = datetime.utcnow().isoformat()
            logger.info(f"[PROGRESS] Run {run_id}: {progress}% - {message}")


def get_next_result_number() -> int:
    """Get next available result_N number from S3"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Delimiter='/'
        )
        
        max_num = 0
        for prefix in response.get('CommonPrefixes', []):
            folder = prefix['Prefix'].rstrip('/')
            # Match both old format (Result_) and new format (result_)
            match = re.match(r'(?:Result_|result_)(\d+)', folder)
            if match:
                num = int(match.group(1))
                if num > max_num:
                    max_num = num
        
        return max_num + 1
    except Exception as e:
        logger.error(f"[ERROR] Error getting next result number: {e}")
        return 1


def upload_results_to_s3(run_id: str, result_data: Dict[str, Any], output_dir: str) -> str:
    """Upload results to S3 and return folder name"""
    try:
        # Generate folder name using new lowercase format
        result_num = get_next_result_number()
        folder_name = f"result_{result_num}"
        
        # Upload all files from output directory
        import os
        import glob
        
        if os.path.exists(output_dir):
            # Upload all files from solver output directory
            for file_path in glob.glob(os.path.join(output_dir, '*')):
                if os.path.isfile(file_path):
                    file_name = os.path.basename(file_path)
                    s3_key = f"{folder_name}/{file_name}"
                    
                    with open(file_path, 'rb') as f:
                        file_content = f.read()
                    
                    # Determine content type
                    if file_name.endswith('.json'):
                        content_type = 'application/json'
                    elif file_name.endswith('.xlsx'):
                        content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    elif file_name.endswith('.log'):
                        content_type = 'text/plain'
                    else:
                        content_type = 'application/octet-stream'
                    
                    s3_client.put_object(
                        Bucket=S3_BUCKET,
                        Key=s3_key,
                        Body=file_content,
                        ContentType=content_type
                    )
                    logger.info(f"[S3] Uploaded {file_name} to {s3_key}")
        
        # Upload metadata.json with summary
        metadata = {
            'run_id': run_id,
            'created_at': datetime.utcnow().isoformat(),
            'solver_type': 'aws_lambda',
            'solutions_count': len(result_data.get('solutions', [])),
            'folder_name': folder_name,
            'result_number': result_num
        }
        
        metadata_key = f"{folder_name}/metadata.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=metadata_key,
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        
        logger.info(f"[S3] Uploaded results to S3: {folder_name}")
        return folder_name
        
    except Exception as e:
        logger.error(f"[ERROR] Failed to upload to S3: {e}")
        raise


# ============================================================================
# BACKGROUND OPTIMIZATION TASK
# =============================================================================

async def run_optimization(case_data: Dict[str, Any], run_id: str):
    """Background task for running optimization with REAL solver"""
    try:
        active_runs[run_id]["status"] = "running"
        update_progress(run_id, 2, "Validating input...")
        
        # Import the Lambda-compatible solver (no tkinter dependencies)
        try:
            import solver_core_real
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            logger.error(f"[ERROR] Failed to import solver_core_real - {error_msg}")
            import traceback
            logger.error(f"[TRACEBACK] {traceback.format_exc()}")
            active_runs[run_id].update({
                "status": "failed",
                "progress": -1,
                "message": "Solver not available",
                "error": error_msg,
                "completed_at": datetime.utcnow().isoformat()
            })
            return
        
        update_progress(run_id, 10, "Preparing optimization model...")
        
        # Save case to temp file
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as tmp:
            json.dump(case_data, tmp)
            tmp_path = tmp.name
        
        try:
            update_progress(run_id, 20, "Running optimization solver...")
            
            # Run the REAL solver (Lambda-compatible version without tkinter)
            try:
                tables, meta = solver_core_real.Solve_test_case_lambda(tmp_path)
            except Exception as solver_error:
                logger.error(f"[SOLVER ERROR] {type(solver_error).__name__}: {solver_error}")
                import traceback as tb
                logger.error(f"[FULL TRACEBACK]\n{tb.format_exc()}")
                raise
            
            # Get the output directory where solver wrote files
            output_dir = meta.get('output_dir', '/tmp')
            
            update_progress(run_id, 70, "Processing solutions...")
            
            # Convert to expected format
            solutions = []
            for i, table_data in enumerate(tables):
                assignments = []
                for (s_idx, p_idx) in table_data.get('assignment', []):
                    shift = table_data['shifts'][s_idx]
                    provider = table_data['providers'][p_idx]
                    assignments.append({
                        "shift_id": shift['id'],
                        "provider_name": provider['name'],
                        "date": shift['date'],
                        "shift_type": shift.get('type', ''),
                        "start_time": shift.get('start', ''),
                        "end_time": shift.get('end', '')
                    })
                
                objective = (meta.get('per_table', [])[i].get('objective') 
                           if i < len(meta.get('per_table', [])) else 0)
                
                solutions.append({
                    "assignments": assignments,
                    "objective_value": objective
                })
            
            result = {
                'status': 'completed',
                'solutions': solutions,
                'solver_stats': meta.get('phase2', {})
            }
            
        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except:
                pass
        
        update_progress(run_id, 90, "Uploading results to S3...")
        
        # Upload to S3 - pass output directory
        folder_name = upload_results_to_s3(run_id, result, output_dir)
        
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
        
        logger.info(f"[SUCCESS] Run {run_id} completed successfully: {folder_name}")
        
    except Exception as e:
        logger.error(f"[ERROR] Optimization failed for run {run_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        active_runs[run_id].update({
            "status": "failed",
            "progress": -1,
            "message": str(e),
            "error": str(e),
            "completed_at": datetime.utcnow().isoformat()
        })


# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.post("/solve")
async def solve(case: SchedulingCase, background_tasks: BackgroundTasks):
    """Start optimization (synchronous - runs within Lambda timeout)"""
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
        
        logger.info(f"[SOLVE] Starting optimization run: {run_id}")
        
        # Run optimization SYNCHRONOUSLY (important for Lambda)
        # Lambda has up to 15 minutes timeout, which is enough for most cases
        import asyncio
        loop = asyncio.get_event_loop()
        await run_optimization(case.dict(), run_id)
        
        logger.info(f"[SOLVE] Completed optimization run: {run_id}")
        
        # Return the completed result
        run_data = active_runs[run_id]
        response = {
            "run_id": run_id,
            "status": run_data["status"],
            "progress": run_data.get("progress", 100),
            "message": run_data["message"]
        }
        
        if run_data["status"] == "completed":
            response["results"] = run_data.get("result")
            response["output_directory"] = run_data.get("output_directory")
        
        if run_data["status"] == "failed":
            response["error"] = run_data.get("error", "Unknown error")
        
        return response
        
    except Exception as e:
        logger.error(f"[ERROR] Failed to run optimization: {e}")
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
    """List all Result_N folders in S3 with file info"""
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
                for file_obj in files_response.get('Contents', []):
                    key = file_obj['Key']
                    # Don't count the folder itself
                    if key != f"{folder_name}/":
                        file_count += 1
                        total_size += file_obj['Size']
                
                folders.append({
                    'name': folder_name,
                    'created': metadata.get('created_at'),
                    'solver_type': metadata.get('solver_type', 'aws_lambda'),
                    'solutions_count': metadata.get('solutions_count', 0),
                    'file_count': file_count,
                    'total_size': total_size
                })
            except Exception as e:
                logger.warning(f"[WARN] Error getting info for {folder_name}: {e}")
                folders.append({
                    'name': folder_name,
                    'created': datetime.utcnow().isoformat(),
                    'solver_type': 'aws_lambda',
                    'solutions_count': 0,
                    'file_count': 0,
                    'total_size': 0
                })
        
        folders.sort(key=lambda x: x['name'], reverse=True)
        return {"folders": folders}
        
    except Exception as e:
        logger.error(f"[ERROR] Error listing folders: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/folder/info/{folder_name}")
async def get_folder_info(folder_name: str):
    """Get file information for a folder"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=f"{folder_name}/"
        )
        
        if 'Contents' not in response:
            raise HTTPException(status_code=404, detail="Folder not found")
        
        files = []
        total_size = 0
        
        for obj in response['Contents']:
            key = obj['Key']
            filename = key.replace(f"{folder_name}/", "")
            
            if filename:  # Skip folder itself
                size = obj['Size']
                files.append({
                    'name': filename,
                    'size': size,
                    'modified': obj['LastModified'].isoformat()
                })
                total_size += size
        
        return {
            'folder': folder_name,
            'files': files,
            'file_count': len(files),
            'total_size': total_size
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ERROR] Error getting folder info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download/folder/{folder_name}")
async def download_folder(folder_name: str):
    """Download a Result_N folder as ZIP from S3"""
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
            headers={
                "Content-Disposition": f"attachment; filename={folder_name}.zip"
            }
        )
        
    except Exception as e:
        logger.error(f"[ERROR] Error downloading folder: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/results/delete/{folder_name}")
async def delete_folder(folder_name: str):
    """Delete a Result_N folder from S3"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Prefix=f"{folder_name}/"
        )
        
        if 'Contents' not in response:
            raise HTTPException(status_code=404, detail="Folder not found")
        
        for obj in response['Contents']:
            s3_client.delete_object(Bucket=S3_BUCKET, Key=obj['Key'])
        
        logger.info(f"[S3] Deleted folder: {folder_name}")
        return {"status": "deleted", "folder": folder_name}
        
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
        "active_runs": len(active_runs),
        "s3_bucket": S3_BUCKET,
        "region": AWS_REGION,
        "solver": "real_ortools"
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
            "DELETE /results/delete/{folder_name}": "Delete result folder",
            "GET /health": "Health check"
        },
        "storage": "AWS S3",
        "execution": "Async with progress tracking",
        "solver": "Real OR-Tools (via testcase_gui)"
    }


# AWS Lambda handler (using Mangum)
# Configure with lifespan='off' to handle direct Lambda invocations
handler = Mangum(
    app,
    lifespan="off",  # Disable ASGI lifespan for Lambda
)
# For local testing
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
