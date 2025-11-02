# Cost-Optimized ECS Architecture

## Problem
The original ECS service ran **24/7**, polling SQS every 20 seconds even when idle, costing money unnecessarily.

## Solution: On-Demand ECS Tasks

### New Architecture
```
User → API Lambda → SQS → Trigger Lambda → ECS Fargate Task (on-demand)
                                              ↓
                                           Solver runs
                                              ↓
                                           Task stops
                                              ↓
                                         💰 $0 idle cost!
```

### Components

1. **API Lambda** (`lambda_handler.py`)
   - Receives solve requests from frontend
   - Creates initial S3 status file
   - Queues job to SQS

2. **SQS Queue** (`scheduling-solver-jobs`)
   - 12-hour visibility timeout
   - Triggers Lambda automatically

3. **Trigger Lambda** (`sqs_ecs_trigger.py`) ⭐ NEW
   - Triggered by SQS messages (no polling!)
   - Stores job data in S3
   - Starts ECS Fargate task with `SINGLE_RUN_MODE=true`

4. **ECS Fargate Task** (`solver_worker_ecs.py`)
   - **Single-run mode**: Reads job from S3, runs solver, exits
   - **Polling mode**: Old behavior (for backwards compatibility)
   - Runs for hours if needed (no timeout)
   - Stops automatically when done

### Cost Comparison

| Component | Old Architecture | New Architecture | Savings |
|-----------|-----------------|------------------|---------|
| ECS Service | Running 24/7 | On-demand only | ~95% |
| Lambda (Trigger) | N/A | $0.20 per 1M requests | Minimal |
| Lambda (API) | Same | Same | - |
| SQS | Same | Same | - |
| S3 | Same | Same | - |

**Estimated Monthly Cost** (assuming 100 solver runs):
- **Old**: ~$50-100/month (ECS running 24/7)
- **New**: ~$2-5/month (ECS only when solving)

### Deployment

#### Option 1: Automated (GitHub Actions)
```bash
# Just push to master - workflow handles deployment
git add sqs_ecs_trigger.py .github/workflows/deploy-sqs-trigger.yml
git commit -m "Add on-demand ECS architecture"
git push origin master
```

#### Option 2: Manual Deployment
```bash
python deploy_sqs_trigger.py
```

#### Post-Deployment Steps

1. **Get VPC Configuration**:
   ```bash
   # Get default VPC subnets
   aws ec2 describe-subnets --filters "Name=default-for-az,Values=true" --query "Subnets[*].SubnetId" --output text
   
   # Get default security group
   aws ec2 describe-security-groups --filters "Name=group-name,Values=default" --query "SecurityGroups[0].GroupId" --output text
   ```

2. **Update Lambda Environment**:
   ```bash
   aws lambda update-function-configuration \
     --function-name scheduling-solver-sqs-trigger \
     --environment "Variables={
       ECS_CLUSTER=scheduling-solver-cluster,
       ECS_TASK_DEFINITION=solver-worker,
       S3_RESULTS_BUCKET=scheduling-solver-results,
       AWS_REGION=us-east-1,
       ECS_SUBNETS=subnet-xxx,subnet-yyy,
       ECS_SECURITY_GROUPS=sg-xxx
     }" \
     --region us-east-1
   ```

3. **Scale Down Old ECS Service** (stop 24/7 polling):
   ```bash
   aws ecs update-service \
     --cluster scheduling-solver-cluster \
     --service solver-worker \
     --desired-count 0 \
     --region us-east-1
   ```

4. **Test the New System**:
   - Submit a solver job from frontend
   - Watch CloudWatch logs: `/aws/lambda/scheduling-solver-sqs-trigger`
   - Watch ECS task start: `aws ecs list-tasks --cluster scheduling-solver-cluster`
   - Verify solver completes and task stops automatically

### Monitoring

```bash
# Check Lambda trigger logs
aws logs tail /aws/lambda/scheduling-solver-sqs-trigger --follow

# Check ECS tasks (should be 0 when idle)
aws ecs list-tasks --cluster scheduling-solver-cluster

# Check running tasks
aws ecs describe-tasks --cluster scheduling-solver-cluster --tasks <task-arn>
```

### Rollback

If issues occur, revert to polling mode:
```bash
aws ecs update-service \
  --cluster scheduling-solver-cluster \
  --service solver-worker \
  --desired-count 1 \
  --region us-east-1
```

### How It Works

1. **User submits solve request** → API Lambda
2. **API Lambda** creates S3 status, sends message to SQS
3. **SQS** triggers Trigger Lambda automatically
4. **Trigger Lambda**:
   - Stores full job data in S3 (`jobs/{run_id}/input.json`)
   - Starts ECS task with `RUN_ID` and `SINGLE_RUN_MODE=true`
5. **ECS Task** (solver_worker_ecs.py):
   - Reads `SINGLE_RUN_MODE` env var
   - If true: Loads job from S3, runs solver, exits
   - If false: Polls SQS forever (old mode)
6. **Solver completes** → uploads results to S3 → task stops
7. **Frontend** polls S3 status, shows results when ready

### Safety Features

- **12-hour visibility timeout**: Prevents message reprocessing
- **S3 persistence**: Job survives Lambda restarts
- **Idempotent**: Safe to retry failed tasks
- **Backwards compatible**: Can switch back to polling mode anytime

### Environment Variables

**sqs_ecs_trigger.py (Trigger Lambda)**:
- `ECS_CLUSTER`: ECS cluster name
- `ECS_TASK_DEFINITION`: Task definition family name
- `ECS_SUBNETS`: Comma-separated subnet IDs
- `ECS_SECURITY_GROUPS`: Comma-separated security group IDs
- `S3_RESULTS_BUCKET`: S3 bucket for results
- `AWS_REGION`: AWS region

**solver_worker_ecs.py (ECS Task)**:
- `SINGLE_RUN_MODE`: "true" for on-demand, "false" for polling
- `RUN_ID`: Job ID to process (single-run mode only)
- `S3_RESULTS_BUCKET`: S3 bucket for results
- `SQS_QUEUE_URL`: SQS queue URL (polling mode only)

### Troubleshooting

**Task not starting?**
- Check Lambda logs: `/aws/lambda/scheduling-solver-sqs-trigger`
- Verify subnets and security groups are set
- Check IAM permissions (Lambda needs ECS:RunTask)

**Task starting but failing immediately?**
- Check ECS logs: `/ecs/solver-worker`
- Verify `RUN_ID` environment variable is set
- Check S3 for job input file: `jobs/{run_id}/input.json`

**Old polling service still running?**
- Scale down: `aws ecs update-service --desired-count 0`
- Verify: `aws ecs describe-services --cluster scheduling-solver-cluster --services solver-worker`

---

🎉 **Result**: ECS tasks only run when solving, saving ~95% on ECS costs!
