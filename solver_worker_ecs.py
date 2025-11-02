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

if not SQS_QUEUE_URL:
    raise ValueError("SQS_QUEUE_URL environment variable is required")

# Initialize AWS clients
s3_client = boto3.client('s3', region_name=AWS_REGION)
sqs_client = boto3.client('sqs', region_name=AWS_REGION)

# Import the real solver
try:
    import solver_core_real
except ImportError:
    logger.error("Could not import solver_core_real - solver will fail")
    solver_core_real = None


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
        status_key = f"jobs/{run_id}/status.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=status_key,
            Body=json.dumps({
                'run_id': run_id,
                'status': status,
                'updated_at': datetime.utcnow().isoformat(),
                'metadata': metadata
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
    
    try:
        # Update status: running
        update_job_status(run_id, 'running', {'progress': 0, 'message': 'Solver started'})
        
        # Create temp directory for solver output
        with tempfile.TemporaryDirectory() as temp_dir:
            logger.info(f"Temporary directory: {temp_dir}")
            
            # Run the solver - THIS CAN TAKE HOURS!
            logger.info("Starting solver...")
            start_time = time.time()
            
            result = solver_core_real.solve_case(
                constants=case_data.get('constants', {}),
                calendar=case_data.get('calendar', {}),
                shifts=case_data.get('shifts', []),
                providers=case_data.get('providers', []),
                run_config=case_data.get('run', {}),
                output_dir=temp_dir
            )
            
            elapsed = time.time() - start_time
            logger.info(f"Solver completed in {elapsed:.2f}s")
            
            # Upload results to S3
            metadata = {
                'run_id': run_id,
                'runtime_seconds': elapsed,
                'solver_stats': result.get('solver_stats', {}),
                'solutions_count': len(result.get('solutions', [])),
                'timestamp': datetime.utcnow().isoformat()
            }
            
            folder_name = upload_results_to_s3(run_id, temp_dir, metadata)
            
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
    poll_sqs_forever()
