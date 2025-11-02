"""
SQS to ECS Trigger Lambda
==========================

This Lambda is triggered by SQS messages and starts ECS Fargate tasks on-demand.
This eliminates the need for a constantly-running ECS service, saving costs.

Architecture:
1. API Lambda queues job to SQS
2. SQS triggers this Lambda
3. This Lambda starts ECS Fargate task
4. ECS task runs solver and exits
5. No idle costs!

Environment Variables Required:
    ECS_CLUSTER: ECS cluster name (e.g., 'scheduling-solver-cluster')
    ECS_TASK_DEFINITION: Task definition ARN or family name
    ECS_SUBNETS: Comma-separated subnet IDs
    ECS_SECURITY_GROUPS: Comma-separated security group IDs
    S3_RESULTS_BUCKET: S3 bucket for results
    AWS_REGION: AWS region
"""

import json
import logging
import os
import boto3
from typing import Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sqs-ecs-trigger")

# AWS Configuration
ECS_CLUSTER = os.environ.get('ECS_CLUSTER', 'scheduling-solver-cluster')
ECS_TASK_DEFINITION = os.environ.get('ECS_TASK_DEFINITION', 'solver-worker')
ECS_SUBNETS = os.environ.get('ECS_SUBNETS', '').split(',')
ECS_SECURITY_GROUPS = os.environ.get('ECS_SECURITY_GROUPS', '').split(',')
S3_BUCKET = os.environ.get('S3_RESULTS_BUCKET', 'scheduling-solver-results')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Initialize AWS clients
ecs_client = boto3.client('ecs', region_name=AWS_REGION)
s3_client = boto3.client('s3', region_name=AWS_REGION)


def lambda_handler(event, context):
    """
    Lambda handler triggered by SQS messages.
    Starts an ECS Fargate task for each message.
    """
    logger.info(f"Received SQS event with {len(event.get('Records', []))} messages")
    
    for record in event.get('Records', []):
        try:
            # Parse SQS message
            message_body = json.loads(record['body'])
            run_id = message_body.get('run_id')
            case_data = message_body.get('case')
            
            if not run_id or not case_data:
                logger.error(f"Invalid message format: {message_body}")
                continue
            
            logger.info(f"Processing job {run_id}")
            
            # Update S3 status to "starting"
            update_s3_status(run_id, "starting", 0, "Starting ECS task...")
            
            # Start ECS Fargate task
            task_arn = start_ecs_task(run_id, message_body)
            
            if task_arn:
                logger.info(f"Started ECS task {task_arn} for job {run_id}")
                update_s3_status(run_id, "running", 0, "Solver task started")
            else:
                logger.error(f"Failed to start ECS task for job {run_id}")
                update_s3_status(run_id, "failed", 0, "Failed to start solver task")
        
        except Exception as e:
            logger.error(f"Error processing message: {e}", exc_info=True)
            # Don't raise - allow other messages to process
    
    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Processed SQS messages'})
    }


def start_ecs_task(run_id: str, job_data: Dict[str, Any]) -> str:
    """
    Start an ECS Fargate task to run the solver.
    Returns the task ARN if successful, None otherwise.
    """
    try:
        # Store job data in S3 for the ECS task to retrieve
        job_key = f"jobs/{run_id}/input.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=job_key,
            Body=json.dumps(job_data),
            ContentType='application/json'
        )
        logger.info(f"Stored job data at s3://{S3_BUCKET}/{job_key}")
        
        # Start ECS task with run_id as environment variable
        response = ecs_client.run_task(
            cluster=ECS_CLUSTER,
            taskDefinition=ECS_TASK_DEFINITION,
            launchType='FARGATE',
            networkConfiguration={
                'awsvpcConfiguration': {
                    'subnets': ECS_SUBNETS,
                    'securityGroups': ECS_SECURITY_GROUPS,
                    'assignPublicIp': 'ENABLED'
                }
            },
            overrides={
                'containerOverrides': [
                    {
                        'name': 'solver-worker',
                        'environment': [
                            {'name': 'RUN_ID', 'value': run_id},
                            {'name': 'S3_BUCKET', 'value': S3_BUCKET},
                            {'name': 'SINGLE_RUN_MODE', 'value': 'true'}
                        ]
                    }
                ]
            }
        )
        
        if response.get('tasks'):
            task_arn = response['tasks'][0]['taskArn']
            logger.info(f"ECS task started: {task_arn}")
            return task_arn
        else:
            failures = response.get('failures', [])
            logger.error(f"ECS task failed to start: {failures}")
            return None
    
    except Exception as e:
        logger.error(f"Error starting ECS task: {e}", exc_info=True)
        return None


def update_s3_status(run_id: str, status: str, progress: int, message: str):
    """Update job status in S3"""
    try:
        status_key = f"runs/{run_id}/status.json"
        status_data = {
            'run_id': run_id,
            'status': status,
            'progress': progress,
            'message': message,
            'updated_at': context.aws_request_id if 'context' in globals() else 'unknown'
        }
        
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=status_key,
            Body=json.dumps(status_data),
            ContentType='application/json'
        )
        logger.info(f"Updated status: {status} - {message}")
    
    except Exception as e:
        logger.error(f"Error updating S3 status: {e}", exc_info=True)
