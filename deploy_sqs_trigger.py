"""
Deploy SQS-to-ECS Trigger Lambda
=================================

This script packages and deploys the Lambda function that:
1. Receives SQS messages
2. Starts ECS Fargate tasks on-demand
3. Eliminates idle ECS costs

Usage:
    python deploy_sqs_trigger.py
"""

import subprocess
import json
import os

FUNCTION_NAME = "scheduling-solver-sqs-trigger"
REGION = "us-east-1"
ACCOUNT_ID = "433864970068"
ROLE_NAME = "lambda-sqs-ecs-trigger-role"

def run_command(cmd, description):
    """Run shell command and return output"""
    print(f"\n{'='*60}")
    print(f"📦 {description}")
    print(f"{'='*60}")
    print(f"Command: {cmd}\n")
    
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    print(result.stdout)
    if result.stderr:
        print(f"Warnings/Errors:\n{result.stderr}")
    
    if result.returncode != 0:
        raise Exception(f"Command failed with exit code {result.returncode}")
    
    return result.stdout

def main():
    print("\n🚀 Deploying SQS-to-ECS Trigger Lambda\n")
    
    # 1. Create deployment package
    print("Step 1: Creating deployment package...")
    run_command("pip install --target ./package boto3", "Installing dependencies")
    
    # Copy Lambda code
    with open('package/sqs_ecs_trigger.py', 'w') as f:
        with open('sqs_ecs_trigger.py', 'r') as src:
            f.write(src.read())
    
    # Create zip
    run_command(
        "cd package && zip -r ../sqs_trigger_lambda.zip . && cd ..",
        "Creating deployment package"
    )
    
    # 2. Check if Lambda exists
    print("\nStep 2: Checking if Lambda function exists...")
    try:
        run_command(
            f"aws lambda get-function --function-name {FUNCTION_NAME} --region {REGION}",
            "Checking existing function"
        )
        exists = True
    except:
        exists = False
    
    # 3. Create or update Lambda
    if exists:
        print("\nStep 3: Updating existing Lambda function...")
        run_command(
            f"aws lambda update-function-code "
            f"--function-name {FUNCTION_NAME} "
            f"--zip-file fileb://sqs_trigger_lambda.zip "
            f"--region {REGION}",
            "Updating Lambda code"
        )
    else:
        print("\nStep 3: Creating new Lambda function...")
        
        # First create IAM role if needed
        print("Creating IAM role...")
        
        trust_policy = {
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "lambda.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }
        
        with open('trust-policy.json', 'w') as f:
            json.dump(trust_policy, f)
        
        try:
            run_command(
                f"aws iam create-role "
                f"--role-name {ROLE_NAME} "
                f"--assume-role-policy-document file://trust-policy.json",
                "Creating IAM role"
            )
        except:
            print("Role already exists, continuing...")
        
        # Attach policies
        policies = [
            "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
            "arn:aws:iam::aws:policy/AmazonECS_FullAccess",
            "arn:aws:iam::aws:policy/AmazonS3FullAccess",
            "arn:aws:iam::aws:policy/AmazonSQSFullAccess"
        ]
        
        for policy in policies:
            try:
                run_command(
                    f"aws iam attach-role-policy "
                    f"--role-name {ROLE_NAME} "
                    f"--policy-arn {policy}",
                    f"Attaching policy {policy.split('/')[-1]}"
                )
            except:
                print(f"Policy {policy} already attached")
        
        # Wait for role to propagate
        print("\nWaiting 10 seconds for IAM role to propagate...")
        import time
        time.sleep(10)
        
        # Create Lambda
        run_command(
            f"aws lambda create-function "
            f"--function-name {FUNCTION_NAME} "
            f"--runtime python3.11 "
            f"--role arn:aws:iam::{ACCOUNT_ID}:role/{ROLE_NAME} "
            f"--handler sqs_ecs_trigger.lambda_handler "
            f"--zip-file fileb://sqs_trigger_lambda.zip "
            f"--timeout 60 "
            f"--memory-size 256 "
            f"--region {REGION}",
            "Creating Lambda function"
        )
    
    # 4. Set environment variables
    print("\nStep 4: Setting environment variables...")
    
    # Get VPC config (subnets and security groups)
    print("Retrieving VPC configuration...")
    
    env_vars = {
        "ECS_CLUSTER": "scheduling-solver-cluster",
        "ECS_TASK_DEFINITION": "solver-worker",
        "S3_RESULTS_BUCKET": "scheduling-solver-results",
        "AWS_REGION": REGION,
        # Note: ECS_SUBNETS and ECS_SECURITY_GROUPS will be added manually or via console
    }
    
    env_json = json.dumps({"Variables": env_vars})
    
    run_command(
        f"aws lambda update-function-configuration "
        f"--function-name {FUNCTION_NAME} "
        f"--environment '{env_json}' "
        f"--region {REGION}",
        "Setting environment variables"
    )
    
    # 5. Create SQS trigger
    print("\nStep 5: Creating SQS trigger...")
    
    queue_arn = f"arn:aws:sqs:{REGION}:{ACCOUNT_ID}:scheduling-solver-jobs"
    
    try:
        run_command(
            f"aws lambda create-event-source-mapping "
            f"--function-name {FUNCTION_NAME} "
            f"--event-source-arn {queue_arn} "
            f"--batch-size 1 "
            f"--region {REGION}",
            "Creating SQS trigger"
        )
    except:
        print("SQS trigger already exists")
    
    # Cleanup
    print("\nStep 6: Cleanup...")
    os.remove('trust-policy.json')
    
    print("\n" + "="*60)
    print("✅ DEPLOYMENT COMPLETE!")
    print("="*60)
    print(f"\nLambda Function: {FUNCTION_NAME}")
    print(f"Region: {REGION}")
    print("\n⚠️  MANUAL STEPS REQUIRED:")
    print("1. Add ECS_SUBNETS to Lambda environment (comma-separated subnet IDs)")
    print("2. Add ECS_SECURITY_GROUPS to Lambda environment (comma-separated SG IDs)")
    print("3. Scale ECS service to 0 tasks to stop polling mode:")
    print(f"   aws ecs update-service --cluster scheduling-solver-cluster --service solver-worker --desired-count 0")
    print("\n")

if __name__ == "__main__":
    main()
