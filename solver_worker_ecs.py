"""
ECS Fargate Worker - SQS Message Processor (NO TIME LIMIT)
============================================================

This runs in ECS Fargate and can process solver jobs for HOURS.
Unlike Lambda's 15-minute limit, this can run indefinitely.

Environment Variables:
    S3_RESULTS_BUCKET: S3 bucket for results
    AWS_REGION: AWS region
    SQS_QUEUE_URL: SQS queue URL to poll
"""

import json
import logging
import os
import shutil
import tempfile
import boto3
import time
import threading
from datetime import datetime
from typing import Dict, Any, List, Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s'
)
logger = logging.getLogger("ecs-solver-worker")

# AWS Configuration
S3_BUCKET = os.environ.get('S3_RESULTS_BUCKET', 'scheduling-solver-results')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL')

# Single run mode: process one job and exit (triggered by Lambda)
SINGLE_RUN_MODE = os.environ.get('SINGLE_RUN_MODE', 'false').lower() == 'true'
RUN_ID = os.environ.get('RUN_ID')  # Only used in single-run mode

if not SINGLE_RUN_MODE and not SQS_QUEUE_URL:
    raise ValueError("SQS_QUEUE_URL required for polling mode (or set SINGLE_RUN_MODE=true)")

# Initialize AWS clients
s3_client = boto3.client('s3', region_name=AWS_REGION)
if not SINGLE_RUN_MODE:
    sqs_client = boto3.client('sqs', region_name=AWS_REGION)

# Import the real solver
try:
    import solver_core_real
except ImportError:
    logger.error("Could not import solver_core_real - solver will fail")
    solver_core_real = None


class SmoothProgressTracker:
    """Updates progress smoothly throughout long-running solve"""
    def __init__(self, run_id: str, estimated_duration_seconds: float = 7200.0):
        self.run_id = run_id
        self.estimated_duration = estimated_duration_seconds  # 2 hours default
        self.start_time = time.time()
        self.stop_flag = threading.Event()
        self.thread = None
        self.last_progress = 0
        
    def start(self):
        """Start background progress updates"""
        self.thread = threading.Thread(target=self._update_loop, daemon=True)
        self.thread.start()
        logger.info(f"Started smooth progress tracker (estimated {self.estimated_duration}s)")
        
    def stop(self):
        """Stop progress updates"""
        self.stop_flag.set()
        if self.thread:
            self.thread.join(timeout=2.0)
            
    def _update_loop(self):
        """Background loop that smoothly updates progress"""
        while not self.stop_flag.is_set():
            elapsed = time.time() - self.start_time
            
            # Smooth logarithmic progress curve (fast at start, slows toward 100%)
            # Never reaches 100% - solver completion will set that
            if elapsed < 60:
                # First minute: 0% -> 20%
                progress = int(20 * (elapsed / 60))
            elif elapsed < 300:
                # Minutes 1-5: 20% -> 50%
                progress = 20 + int(30 * ((elapsed - 60) / 240))
            elif elapsed < 1800:
                # Minutes 5-30: 50% -> 75%
                progress = 50 + int(25 * ((elapsed - 300) / 1500))
            elif elapsed < 3600:
                # Minutes 30-60: 75% -> 85%
                progress = 75 + int(10 * ((elapsed - 1800) / 1800))
            elif elapsed < 7200:
                # Hours 1-2: 85% -> 92%
                progress = 85 + int(7 * ((elapsed - 3600) / 3600))
            else:
                # After 2 hours: 92% -> 95% (very slow)
                progress = 92 + int(3 * min(1.0, (elapsed - 7200) / 3600))
            
            # Ensure progress only moves forward
            progress = max(progress, self.last_progress)
            progress = min(progress, 95)  # Cap at 95% until solver finishes
            
            if progress > self.last_progress:
                self._update_status(progress)
                self.last_progress = progress
            
            time.sleep(10)  # Update every 10 seconds
            
    def _update_status(self, progress: int):
        """Update status in S3"""
        try:
            status_key = f"runs/{self.run_id}/status.json"
            elapsed = int(time.time() - self.start_time)
            
            # Progress messages
            if progress < 20:
                message = "Initializing solver..."
            elif progress < 50:
                message = "Finding feasible solution..."
            elif progress < 75:
                message = "Optimizing solution quality..."
            elif progress < 85:
                message = "Exploring solution space..."
            elif progress < 92:
                message = "Fine-tuning assignments..."
            else:
                message = "Finalizing optimal solution..."
            
            s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=status_key,
                Body=json.dumps({
                    'run_id': self.run_id,
                    'status': 'running',
                    'progress': progress,
                    'message': f"{message} {progress}%",
                    'elapsed_seconds': elapsed,
                    'updated_at': datetime.utcnow().isoformat()
                }, indent=2),
                ContentType='application/json'
            )
            logger.info(f"Progress: {progress}% - {message} ({elapsed}s elapsed)")
        except Exception as e:
            logger.error(f"Failed to update progress: {e}")



def get_next_result_number() -> int:
    """Get next available result_N number from S3"""
    try:
        response = s3_client.list_objects_v2(
            Bucket=S3_BUCKET,
            Delimiter='/'
        )
        
        prefixes = response.get('CommonPrefixes', [])
        if not prefixes:
            return 1
        
        # Extract numbers from result_N folders
        numbers = []
        for prefix in prefixes:
            folder_name = prefix['Prefix'].rstrip('/')
            if folder_name.startswith('result_'):
                try:
                    num = int(folder_name.replace('result_', ''))
                    numbers.append(num)
                except ValueError:
                    pass
        
        return max(numbers) + 1 if numbers else 1
    except Exception as e:
        logger.error(f"Error getting next result number: {e}")
        return int(datetime.utcnow().timestamp())


def upload_results_to_s3(run_id: str, solver_output_dir: str, metadata: Dict[str, Any]) -> str:
    """Upload ALL files from solver output directory to S3"""
    
    try:
        # Get next folder number
        result_num = get_next_result_number()
        folder_name = f"result_{result_num}"
        
        logger.info(f"Uploading results to S3: {folder_name}")
        logger.info(f"Source directory: {solver_output_dir}")
        
        if not os.path.exists(solver_output_dir):
            logger.error(f"Output directory not found: {solver_output_dir}")
            return folder_name
        
        # Count files
        all_files = []
        for root, dirs, files in os.walk(solver_output_dir):
            for filename in files:
                filepath = os.path.join(root, filename)
                all_files.append(filepath)
        
        logger.info(f"Found {len(all_files)} files to upload")
        
        # Upload each file
        for filepath in all_files:
            relative_path = os.path.relpath(filepath, solver_output_dir)
            s3_key = f"{folder_name}/{relative_path}".replace('\\', '/')
            
            try:
                s3_client.upload_file(filepath, S3_BUCKET, s3_key)
                logger.info(f"Uploaded: {s3_key}")
            except Exception as upload_error:
                logger.error(f"Failed to upload {relative_path}: {upload_error}")
        
        # Upload metadata
        metadata_key = f"{folder_name}/metadata.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=metadata_key,
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        
        logger.info(f"Successfully uploaded all results to {folder_name}")
        return folder_name
        
    except Exception as e:
        logger.error(f"Error uploading results: {e}")
        raise


def update_job_status(run_id: str, status: str, metadata: Dict[str, Any]):
    """Update job status in S3 (for frontend polling)"""
    try:
        status_key = f"runs/{run_id}/status.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=status_key,
            Body=json.dumps({
                'run_id': run_id,
                'status': status,
                'progress': metadata.get('progress', 0),
                'message': metadata.get('message', ''),
                'updated_at': datetime.utcnow().isoformat(),
                'result': metadata.get('result'),
                'output_directory': metadata.get('output_directory')
            }, indent=2),
            ContentType='application/json'
        )
        logger.info(f"Updated job status: {run_id} -> {status}")
    except Exception as e:
        logger.error(f"Failed to update job status: {e}")


def process_solver_job(message_body: Dict[str, Any]):
    """
    Process a single solver job from SQS.
    This can run for HOURS - no timeout constraint!
    """
    
    run_id = message_body.get('run_id')
    case_data = message_body.get('case')
    
    if not run_id or not case_data:
        logger.error("Invalid message - missing run_id or case")
        return
    
    logger.info(f"=" * 80)
    logger.info(f"STARTING SOLVER JOB: {run_id}")
    logger.info(f"=" * 80)
    
    progress_tracker = None
    try:
        # Update status: running
        update_job_status(run_id, 'running', {'progress': 0, 'message': 'Solver started'})
        
        # Estimate duration from case constants (default 2 hours)
        constants = case_data.get('constants', {})
        solver_config = constants.get('solver', {})
        estimated_duration = float(solver_config.get('max_time_in_seconds', 7200))
        
        # Start smooth progress tracker for long-running solve
        progress_tracker = SmoothProgressTracker(run_id, estimated_duration)
        progress_tracker.start()
        
        # Create temp directory for solver output
        with tempfile.TemporaryDirectory() as temp_dir:
            logger.info(f"Temporary directory: {temp_dir}")
            
            # Save case data to JSON file (solver_core_real expects a file path)
            case_file_path = os.path.join(temp_dir, 'case.json')
            with open(case_file_path, 'w') as f:
                json.dump(case_data, f, indent=2)
            logger.info(f"Case file saved: {case_file_path}")
            
            # Run the solver - THIS CAN TAKE HOURS!
            logger.info(f"Starting solver (estimated {estimated_duration}s)...")
            start_time = time.time()
            
            # Call the REAL solver (returns tables and metadata)
            tables, meta = solver_core_real.Solve_test_case_lambda(case_file_path)
            
            elapsed = time.time() - start_time
            logger.info(f"Solver completed in {elapsed:.2f}s")
            logger.info(f"Generated {len(tables)} solution(s)")
            
            # Stop progress tracker
            if progress_tracker:
                progress_tracker.stop()
            
            # Get output directory from metadata
            output_dir = meta.get('output_dir', temp_dir)
            logger.info(f"Output directory: {output_dir}")
            
            # Upload results to S3
            metadata = {
                'run_id': run_id,
                'runtime_seconds': elapsed,
                'solutions_count': len(tables),
                'created_at': datetime.utcnow().isoformat(),
                'solver_type': 'aws_ecs',
                'solver_metadata': meta
            }
            
            folder_name = upload_results_to_s3(run_id, output_dir, metadata)
            
            # Update status: completed
            update_job_status(run_id, 'completed', {
                'progress': 100,
                'message': 'Optimization completed',
                'folder': folder_name,
                **metadata
            })
            
            logger.info(f"JOB COMPLETED: {run_id} -> {folder_name}")
            
    except Exception as e:
        logger.error(f"Job failed: {run_id}", exc_info=True)
        
        # Stop progress tracker on error
        if progress_tracker:
            progress_tracker.stop()
            
        update_job_status(run_id, 'failed', {
            'error': str(e),
            'message': f'Solver error: {str(e)}'
        })


def poll_sqs_forever():
    """
    Poll SQS queue forever and process messages.
    Each message = one solver job that can run for HOURS.
    """
    
    logger.info("=" * 80)
    logger.info("ECS FARGATE WORKER STARTED")
    logger.info(f"Queue URL: {SQS_QUEUE_URL}")
    logger.info(f"S3 Bucket: {S3_BUCKET}")
    logger.info(f"Region: {AWS_REGION}")
    logger.info("=" * 80)
    
    while True:
        try:
            # Poll SQS (long polling - 20 second wait)
            logger.info("Polling SQS queue...")
            response = sqs_client.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=1,  # Process one job at a time
                WaitTimeSeconds=20,  # Long polling
                VisibilityTimeout=43200  # 12 hours (max allowed)
            )
            
            messages = response.get('Messages', [])
            
            if not messages:
                logger.info("No messages in queue, continuing to poll...")
                continue
            
            # Process the message
            message = messages[0]
            receipt_handle = message['ReceiptHandle']
            
            try:
                body = json.loads(message['Body'])
                logger.info(f"Received job: {body.get('run_id')}")
                
                # Process the solver job (can take HOURS)
                process_solver_job(body)
                
                # Delete message from queue (job completed successfully)
                sqs_client.delete_message(
                    QueueUrl=SQS_QUEUE_URL,
                    ReceiptHandle=receipt_handle
                )
                logger.info("Message deleted from queue")
                
            except Exception as job_error:
                logger.error(f"Error processing job: {job_error}", exc_info=True)
                # Message will become visible again after visibility timeout
                
        except Exception as poll_error:
            logger.error(f"Error polling SQS: {poll_error}")
            time.sleep(5)  # Wait before retrying


if __name__ == "__main__":
    if SINGLE_RUN_MODE:
        # Single run mode: process one job from S3 and exit
        logger.info("=" * 80)
        logger.info("ECS FARGATE WORKER STARTED - SINGLE RUN MODE")
        logger.info(f"Run ID: {RUN_ID}")
        logger.info(f"S3 Bucket: {S3_BUCKET}")
        logger.info("=" * 80)
        
        if not RUN_ID:
            logger.error("RUN_ID environment variable required in single-run mode")
            exit(1)
        
        try:
            # Retrieve job data from S3
            job_key = f"jobs/{RUN_ID}/input.json"
            logger.info(f"Retrieving job data from s3://{S3_BUCKET}/{job_key}")
            
            response = s3_client.get_object(Bucket=S3_BUCKET, Key=job_key)
            job_data = json.loads(response['Body'].read())
            
            logger.info(f"Processing job {RUN_ID}")
            
            # Process the solver job
            process_solver_job(job_data)
            
            logger.info("✅ Job completed successfully - exiting")
            exit(0)
        
        except Exception as e:
            logger.error(f"❌ Job failed: {e}", exc_info=True)
            exit(1)
    else:
        # Polling mode: continuously poll SQS (old behavior)
        poll_sqs_forever()
