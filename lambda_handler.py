"""
Lambda handler for FastAPI application
Adapts API Gateway events to FastAPI using Mangum

This handler supports:
1. On-demand execution (Lambda starts when invoked)
2. Automatic termination after completion
3. Progress tracking and log emission
4. Result storage to S3 or /tmp
5. No persistent costs - serverless execution
"""
from mangum import Mangum
from fastapi_solver_service import app
import os
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Create Lambda handler with lifecycle management
handler = Mangum(app, lifespan="off")

# Lambda will automatically:
# 1. Start when invoked (cold start or warm)
# 2. Execute the FastAPI app
# 3. Return response
# 4. Terminate or enter idle state
# 5. No ongoing costs when not running

def lambda_handler(event, context):
    """
    AWS Lambda entry point
    
    This function:
    - Starts on invocation (serverless)
    - Processes the event through FastAPI
    - Returns results
    - Terminates automatically
    """
    try:
        logger.info(f"Lambda invoked with event: {json.dumps(event)}")
        logger.info(f"Lambda context: function_name={context.function_name}, request_id={context.request_id}")
        
        # Log execution details
        logger.info(f"Memory limit: {context.memory_limit_in_mb} MB")
        logger.info(f"Time remaining: {context.get_remaining_time_in_millis()} ms")
        
        # Process through Mangum (FastAPI adapter)
        response = handler(event, context)
        
        logger.info("Lambda execution completed successfully")
        return response
        
    except Exception as e:
        logger.error(f"Lambda execution error: {str(e)}", exc_info=True)
        
        return {
            'statusCode': 500,
            'body': json.dumps({
                'status': 'error',
                'message': str(e),
                'lambda_info': {
                    'function_name': context.function_name,
                    'request_id': context.request_id,
                }
            })
        }

