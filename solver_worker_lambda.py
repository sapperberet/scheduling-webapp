"""
AWS Lambda Worker - SQS Message Processor
==========================================

This Lambda processes solver tasks from SQS queue.
Triggered by SQS events, runs the real solver without timeout pressure.

Environment Variables:
    S3_RESULTS_BUCKET: S3 bucket for results
    AWS_REGION: AWS region
"""

import json
import logging
import os
import shutil
import tempfile
import boto3
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

logger = logging.getLogger("aws-lambda-solver-worker")
logger.setLevel(logging.INFO)

# AWS Configuration
S3_BUCKET = os.environ.get('S3_RESULTS_BUCKET', 'scheduling-solver-results')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Initialize AWS clients
s3_client = boto3.client('s3', region_name=AWS_REGION)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)

# Try to import the real solver
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
        logger.error(f"[ERROR] Error getting next result number: {e}")
        return int(datetime.utcnow().timestamp())


def upload_results_to_s3(run_id: str, tables: List[Dict], metadata: Dict[str, Any], solver_output_dir: str) -> str:
    """Upload solver results to S3 - all files from local solver output (like local solver)"""
    
    try:
        # Get next folder number
        result_num = get_next_result_number()
        folder_name = f"result_{result_num}"
        
        logger.info(f"[S3] Uploading results to {folder_name}")
        logger.info(f"[S3] Source directory: {solver_output_dir}")
        
        if not os.path.exists(solver_output_dir):
            logger.warning(f"[S3] Output directory does not exist: {solver_output_dir}")
            return folder_name
        
        # Upload ALL files from solver output directory to S3
        file_count = 0
        total_size = 0
        
        for root, dirs, files in os.walk(solver_output_dir):
            for filename in files:
                filepath = os.path.join(root, filename)
                
                # Calculate relative path from solver_output_dir
                rel_path = os.path.relpath(filepath, solver_output_dir)
                s3_key = f"{folder_name}/{rel_path}".replace("\\", "/")  # S3 uses forward slashes
                
                try:
                    file_size = os.path.getsize(filepath)
                    total_size += file_size
                    
                    # Determine content type
                    if filename.endswith('.xlsx'):
                        content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    elif filename.endswith('.json'):
                        content_type = 'application/json'
                    elif filename.endswith('.log'):
                        content_type = 'text/plain'
                    else:
                        content_type = 'application/octet-stream'
                    
                    # Upload file to S3
                    with open(filepath, 'rb') as f:
                        s3_client.put_object(
                            Bucket=S3_BUCKET,
                            Key=s3_key,
                            Body=f.read(),
                            ContentType=content_type
                        )
                    
                    file_count += 1
                    logger.info(f"[S3] Uploaded {rel_path} ({file_size} bytes) as {s3_key}")
                    
                except Exception as file_error:
                    logger.error(f"[S3] Error uploading {filename}: {file_error}")
                    continue
        
        logger.info(f"[S3] Completed upload to {folder_name} - {file_count} files ({total_size} bytes)")
        return folder_name
        
    except Exception as e:
        logger.error(f"[ERROR] Error uploading to S3: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise


def process_solver_task(run_id: str, case_data: Dict[str, Any]) -> tuple:
    """Process solver task and return tables, metadata, and output directory"""
    
    logger.info(f"[WORKER] Processing run {run_id}")
    
    if not solver_core_real:
        raise RuntimeError("Solver module not available")
    
    # Create a temporary directory for case input
    temp_dir = tempfile.mkdtemp(prefix=f"solver_input_{run_id}_")
    logger.info(f"[WORKER] Temp input directory: {temp_dir}")
    
    # Save case to temp file
    case_file = os.path.join(temp_dir, 'case.json')
    with open(case_file, 'w') as f:
        json.dump(case_data, f)
    
    try:
        # Run the solver - it returns tables, meta with output_dir
        logger.info(f"[SOLVER] Starting optimization...")
        tables, meta = solver_core_real.Solve_test_case_lambda(case_file)
        
        # Extract output directory from metadata
        output_dir = meta.get('output_dir', None)
        if not output_dir:
            raise RuntimeError("Solver did not return output_dir in metadata")
        
        logger.info(f"[SOLVER] Optimization complete. Generated {len(tables)} solutions")
        logger.info(f"[SOLVER] Output directory: {output_dir}")
        logger.info(f"[SOLVER] Output files count: {meta.get('generated_files', 0)}")
        
        return tables, meta, output_dir
        
    except Exception as e:
        logger.error(f"[SOLVER] Error during solve: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise
    
    finally:
        # Clean up input temp directory
        try:
            shutil.rmtree(temp_dir)
            logger.info(f"[CLEANUP] Removed input directory: {temp_dir}")
        except Exception as e:
            logger.warning(f"[CLEANUP] Could not remove {temp_dir}: {e}")


def lambda_handler(event, context):
    """
    Main SQS event handler
    
    Receives messages from SQS queue and processes solver tasks
    """
    
    logger.info(f"[HANDLER] Processing {len(event['Records'])} SQS messages")
    
    for record in event['Records']:
        solver_output_dir = None
        try:
            message_body = json.loads(record['body'])
            run_id = message_body['run_id']
            case_data = message_body['case']
            
            logger.info(f"[MESSAGE] Processing run {run_id}")
            
            # Process the solver task
            try:
                tables, meta, solver_output_dir = process_solver_task(run_id, case_data)
                
                logger.info(f"[UPLOADER] Uploading {len(tables)} solutions to S3")
                # Upload results to S3 with all solver output files
                folder_name = upload_results_to_s3(run_id, tables, meta, solver_output_dir)
                
                logger.info(f"[SUCCESS] Run {run_id} completed: {folder_name}")
                
            except Exception as solver_error:
                logger.error(f"[SOLVER ERROR] Run {run_id}: {type(solver_error).__name__}: {solver_error}")
                import traceback
                logger.error(f"[TRACEBACK]\n{traceback.format_exc()}")
                raise
            
        except Exception as e:
            logger.error(f"[ERROR] Processing message failed: {e}")
            import traceback
            logger.error(f"[TRACEBACK]\n{traceback.format_exc()}")
            # Don't re-raise - let SQS handle retry logic
            continue
        
        finally:
            # Clean up solver output directory if created
            if solver_output_dir and os.path.exists(solver_output_dir):
                try:
                    shutil.rmtree(solver_output_dir)
                    logger.info(f"[CLEANUP] Removed solver output directory: {solver_output_dir}")
                except Exception as e:
                    logger.warning(f"[CLEANUP] Could not remove {solver_output_dir}: {e}")
    
    return {"statusCode": 200, "body": "Processed"}


# For testing locally
if __name__ == "__main__":
    # Test event
    test_event = {
        "Records": [
            {
                "body": json.dumps({
                    "run_id": "test-run-123",
                    "case": {"test": "data"}
                })
            }
        ]
    }
    
    class MockContext:
        pass
    
    result = lambda_handler(test_event, MockContext())
    print(f"Result: {result}")
