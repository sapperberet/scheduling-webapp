"""
AWS Lambda SQS Worker - Optimization Solver
============================================

This Lambda processes solver work from SQS queue.
It runs the actual optimization and stores results to S3.

Environment Variables Required:
    S3_RESULTS_BUCKET: S3 bucket for results
"""

import json
import logging
import os
import tempfile
import boto3
import threading
import time
from datetime import datetime
from typing import Dict, Any, List

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("aws-lambda-solver-worker")

# AWS S3 Configuration
S3_BUCKET = os.environ.get('S3_RESULTS_BUCKET', 'scheduling-solver-results')

# Initialize S3 client
s3_client = boto3.client('s3')

class ProgressUpdater:
    """Background thread that smoothly updates progress during solve"""
    def __init__(self, run_id: str, start_progress: int, end_progress: int, duration_estimate: float = 15.0):
        self.run_id = run_id
        self.start_progress = start_progress
        self.end_progress = end_progress
        self.duration_estimate = duration_estimate
        self.current_progress = start_progress
        self.stop_flag = threading.Event()
        self.thread = None
        self.start_time = time.time()
        
    def start(self):
        """Start the progress updater thread"""
        self.thread = threading.Thread(target=self._update_loop, daemon=True)
        self.thread.start()
        logger.info(f"[PROGRESS] Started updater: {self.start_progress}% -> {self.end_progress}% over ~{self.duration_estimate}s")
        
    def stop(self):
        """Stop the progress updater thread"""
        self.stop_flag.set()
        if self.thread:
            self.thread.join(timeout=2.0)
        logger.info(f"[PROGRESS] Stopped updater at {self.current_progress}%")
        
    def _update_loop(self):
        """Background loop that updates progress"""
        update_interval = 2.0  # Update every 2 seconds
        
        while not self.stop_flag.is_set():
            elapsed = time.time() - self.start_time
            
            # Calculate progress based on time elapsed
            if elapsed >= self.duration_estimate:
                # Cap at end_progress - 1 (don't reach 100% until solver actually finishes)
                self.current_progress = min(self.end_progress - 1, self.start_progress + int((self.end_progress - self.start_progress) * 0.95))
            else:
                # Linear interpolation with slight randomness to look natural
                progress_ratio = elapsed / self.duration_estimate
                progress_delta = (self.end_progress - self.start_progress) * progress_ratio
                self.current_progress = int(self.start_progress + progress_delta)
            
            # Update S3 status
            try:
                status_key = f"runs/{self.run_id}/status.json"
                status = {
                    "status": "running",
                    "progress": self.current_progress,
                    "message": f"Solving optimization... {self.current_progress}%",
                    "started_at": datetime.utcfromtimestamp(self.start_time).isoformat()
                }
                s3_client.put_object(
                    Bucket=S3_BUCKET,
                    Key=status_key,
                    Body=json.dumps(status, indent=2),
                    ContentType='application/json'
                )
                logger.info(f"[PROGRESS] Updated: {self.current_progress}%")
            except Exception as e:
                logger.warning(f"[PROGRESS] Failed to update: {e}")
            
            # Wait for next update or stop signal
            self.stop_flag.wait(timeout=update_interval)

def store_status_to_s3(run_id: str, status: Dict[str, Any]):
    """Store run status to S3 for cross-Lambda communication"""
    try:
        status_key = f"runs/{run_id}/status.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=status_key,
            Body=json.dumps(status, indent=2),
            ContentType='application/json'
        )
        logger.info(f"[S3] Updated status for run {run_id}: {status.get('status')}")
    except Exception as e:
        logger.error(f"[ERROR] Failed to store status: {e}")
        raise

def get_next_result_number() -> int:
    """Get next available result_N number from S3"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Delimiter='/'
        )
        
        result_numbers = []
        for prefix in response.get('CommonPrefixes', []):
            folder_name = prefix['Prefix'].rstrip('/')
            if folder_name.startswith('result_'):
                try:
                    num = int(folder_name.split('_')[1])
                    result_numbers.append(num)
                except:
                    pass
        
        return max(result_numbers) + 1 if result_numbers else 1
    except Exception as e:
        logger.warning(f"[WARN] Error getting next result number: {e}")
        return 1

def upload_results_to_s3(run_id: str, result: Dict[str, Any], output_dir: str) -> str:
    """Upload optimization results to S3"""
    try:
        result_num = get_next_result_number()
        folder_name = f"result_{result_num}"
        
        # Upload JSON result
        result_key = f"{folder_name}/result.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=result_key,
            Body=json.dumps(result, indent=2),
            ContentType='application/json'
        )
        logger.info(f"[S3] Uploaded result.json to {result_key}")
        
        # Upload files from output directory if it exists
        if os.path.isdir(output_dir):
            for file_name in os.listdir(output_dir):
                file_path = os.path.join(output_dir, file_name)
                if os.path.isfile(file_path):
                    try:
                        with open(file_path, 'rb') as f:
                            file_content = f.read()
                        
                        # Determine content type
                        if file_name.endswith('.csv'):
                            content_type = 'text/csv'
                        elif file_name.endswith('.json'):
                            content_type = 'application/json'
                        else:
                            content_type = 'application/octet-stream'
                        
                        s3_key = f"{folder_name}/{file_name}"
                        s3_client.put_object(
                            Bucket=S3_BUCKET,
                            Key=s3_key,
                            Body=file_content,
                            ContentType=content_type
                        )
                        logger.info(f"[S3] Uploaded {file_name} to {s3_key}")
                    except Exception as e:
                        logger.warning(f"[WARN] Failed to upload {file_name}: {e}")
        
        # Upload metadata
        metadata = {
            'run_id': run_id,
            'created_at': datetime.utcnow().isoformat(),
            'solver_type': 'aws_lambda_worker',
            'solutions_count': len(result.get('solutions', [])),
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

def run_optimization(case_data: Dict[str, Any], run_id: str):
    """Run the optimization solver"""
    status = {
        "run_id": run_id,
        "status": "processing",
        "progress": 0,
        "message": "Optimization started",
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    
    try:
        store_status_to_s3(run_id, status)
        
        status["progress"] = 2
        status["message"] = "Validating input..."
        store_status_to_s3(run_id, status)
        
        # Import the solver
        try:
            import solver_core_real
        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            logger.error(f"[ERROR] Failed to import solver_core_real - {error_msg}")
            import traceback
            logger.error(f"[TRACEBACK] {traceback.format_exc()}")
            
            status.update({
                "status": "failed",
                "progress": -1,
                "message": "Solver not available",
                "error": error_msg,
                "completed_at": datetime.utcnow().isoformat()
            })
            store_status_to_s3(run_id, status)
            return
        
        status["progress"] = 10
        status["message"] = "Preparing optimization model..."
        store_status_to_s3(run_id, status)
        
        # Save case to temp file
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as tmp:
            json.dump(case_data, tmp)
            tmp_path = tmp.name
        
        try:
            status["progress"] = 20
            status["message"] = "Running optimization solver..."
            store_status_to_s3(run_id, status)
            
            # Start smooth progress updates from 20% to 70% during solve
            # Estimate ~15-20 seconds for typical solve
            progress_updater = ProgressUpdater(run_id, start_progress=20, end_progress=70, duration_estimate=18.0)
            progress_updater.start()
            
            # Run the REAL solver
            try:
                tables, meta = solver_core_real.Solve_test_case_lambda(tmp_path)
            except Exception as solver_error:
                logger.error(f"[SOLVER ERROR] {type(solver_error).__name__}: {solver_error}")
                import traceback as tb
                logger.error(f"[FULL TRACEBACK]\n{tb.format_exc()}")
                raise
            finally:
                # Stop progress updater
                progress_updater.stop()
            
            # Get the output directory
            output_dir = meta.get('output_dir', '/tmp')
            
            status["progress"] = 70
            status["message"] = "Processing solutions..."
            store_status_to_s3(run_id, status)
            
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
        
        status["progress"] = 90
        status["message"] = "Uploading results to S3..."
        store_status_to_s3(run_id, status)
        
        # Upload to S3
        folder_name = upload_results_to_s3(run_id, result, output_dir)
        
        status["progress"] = 95
        status["message"] = "Finalizing..."
        store_status_to_s3(run_id, status)
        
        # Mark as complete
        status.update({
            "status": "completed",
            "progress": 100,
            "message": "Optimization completed successfully",
            "output_directory": folder_name,
            "completed_at": datetime.utcnow().isoformat(),
            "result": result  # Include full result for API to return
        })
        store_status_to_s3(run_id, status)
        
        logger.info(f"[SUCCESS] Run {run_id} completed successfully: {folder_name}")
        
    except Exception as e:
        logger.error(f"[ERROR] Optimization failed for run {run_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        
        status.update({
            "status": "failed",
            "progress": -1,
            "message": str(e),
            "error": str(e),
            "completed_at": datetime.utcnow().isoformat()
        })
        store_status_to_s3(run_id, status)

def lambda_handler(event, context):
    """SQS event handler"""
    logger.info(f"[SQS] Received event: {json.dumps(event)}")
    
    try:
        # Handle direct SQS event vs test event
        records = event.get('Records', [])
        if not records:
            logger.warning(f"[WARN] No Records in event, raw event: {json.dumps(event)}")
            return {
                'statusCode': 200,
                'body': json.dumps('No records to process')
            }
        
        # Process SQS records
        for record in records:
            try:
                # SQS records have 'body' key (lowercase)
                if 'body' not in record and 'Body' not in record:
                    logger.error(f"[ERROR] Record has no body: {json.dumps(record)}")
                    continue
                
                body_str = record.get('body') or record.get('Body')
                body = json.loads(body_str)
                run_id = body.get('run_id')
                case_data = body.get('case_data')
                
                if not run_id or not case_data:
                    logger.error(f"[ERROR] Missing run_id or case_data in message: {json.dumps(body)}")
                    continue
                
                logger.info(f"[SQS] Processing run {run_id}")
                run_optimization(case_data, run_id)
                
            except json.JSONDecodeError as e:
                logger.error(f"[ERROR] Failed to parse SQS message: {e}")
                logger.error(f"[ERROR] Record content: {json.dumps(record)}")
                continue
            except Exception as e:
                logger.error(f"[ERROR] Failed to process SQS record: {e}")
                import traceback
                logger.error(traceback.format_exc())
                continue
        
        return {
            'statusCode': 200,
            'body': json.dumps('Messages processed')
        }
        
    except Exception as e:
        logger.error(f"[ERROR] Handler failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }
