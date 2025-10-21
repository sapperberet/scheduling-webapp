#!/bin/bash
# AWS Deployment Script for Scheduling Solver
# This script builds and deploys the solver to AWS ECS

set -e

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
ECR_REPO_NAME="scheduling-solver"
ECS_CLUSTER_NAME="scheduling-cluster"
ECS_SERVICE_NAME="scheduling-solver-service"
ECS_TASK_FAMILY="scheduling-solver"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== AWS Solver Deployment Script ===${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    echo "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

# Get AWS Account ID if not set
if [ -z "$AWS_ACCOUNT_ID" ]; then
    echo "Getting AWS Account ID..."
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo -e "${GREEN}AWS Account ID: $AWS_ACCOUNT_ID${NC}"
fi

# Step 1: Create ECR repository if it doesn't exist
echo -e "\n${YELLOW}Step 1: Setting up ECR repository${NC}"
if ! aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $AWS_REGION &> /dev/null; then
    echo "Creating ECR repository: $ECR_REPO_NAME"
    aws ecr create-repository \
        --repository-name $ECR_REPO_NAME \
        --region $AWS_REGION
    echo -e "${GREEN}✓ ECR repository created${NC}"
else
    echo -e "${GREEN}✓ ECR repository already exists${NC}"
fi

# Step 2: Login to ECR
echo -e "\n${YELLOW}Step 2: Logging in to ECR${NC}"
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
echo -e "${GREEN}✓ Logged in to ECR${NC}"

# Step 3: Build Docker image
echo -e "\n${YELLOW}Step 3: Building Docker image${NC}"
docker build -f Dockerfile.solver -t $ECR_REPO_NAME:latest .
echo -e "${GREEN}✓ Docker image built${NC}"

# Step 4: Tag image
echo -e "\n${YELLOW}Step 4: Tagging image${NC}"
docker tag $ECR_REPO_NAME:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest
echo -e "${GREEN}✓ Image tagged${NC}"

# Step 5: Push to ECR
echo -e "\n${YELLOW}Step 5: Pushing image to ECR${NC}"
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest
echo -e "${GREEN}✓ Image pushed to ECR${NC}"

# Step 6: Create ECS cluster if it doesn't exist
echo -e "\n${YELLOW}Step 6: Setting up ECS cluster${NC}"
if ! aws ecs describe-clusters --clusters $ECS_CLUSTER_NAME --region $AWS_REGION | grep -q "ACTIVE"; then
    echo "Creating ECS cluster: $ECS_CLUSTER_NAME"
    aws ecs create-cluster --cluster-name $ECS_CLUSTER_NAME --region $AWS_REGION
    echo -e "${GREEN}✓ ECS cluster created${NC}"
else
    echo -e "${GREEN}✓ ECS cluster already exists${NC}"
fi

# Step 7: Update task definition with account ID
echo -e "\n${YELLOW}Step 7: Updating task definition${NC}"
TASK_DEF_FILE="aws-ecs-task-definition.json"
TEMP_TASK_DEF="/tmp/task-definition-updated.json"

# Replace placeholder with actual account ID
sed "s/<your-account-id>/$AWS_ACCOUNT_ID/g" $TASK_DEF_FILE > $TEMP_TASK_DEF

# Register task definition
aws ecs register-task-definition \
    --cli-input-json file://$TEMP_TASK_DEF \
    --region $AWS_REGION
echo -e "${GREEN}✓ Task definition registered${NC}"

# Step 8: Update or create service
echo -e "\n${YELLOW}Step 8: Updating ECS service${NC}"
if aws ecs describe-services --cluster $ECS_CLUSTER_NAME --services $ECS_SERVICE_NAME --region $AWS_REGION | grep -q "ACTIVE"; then
    echo "Updating existing service..."
    aws ecs update-service \
        --cluster $ECS_CLUSTER_NAME \
        --service $ECS_SERVICE_NAME \
        --task-definition $ECS_TASK_FAMILY \
        --force-new-deployment \
        --region $AWS_REGION
    echo -e "${GREEN}✓ Service updated${NC}"
else
    echo -e "${YELLOW}Service doesn't exist. Please create it manually in AWS Console with:${NC}"
    echo "  - Cluster: $ECS_CLUSTER_NAME"
    echo "  - Task Definition: $ECS_TASK_FAMILY"
    echo "  - Service Name: $ECS_SERVICE_NAME"
    echo "  - Load Balancer: Application Load Balancer (optional but recommended)"
fi

echo -e "\n${GREEN}=== Deployment Complete! ===${NC}"
echo -e "ECR Image: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest"
echo -e "ECS Cluster: $ECS_CLUSTER_NAME"
echo -e "Task Family: $ECS_TASK_FAMILY"
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Configure Application Load Balancer (if not done)"
echo "2. Set up Route 53 DNS record"
echo "3. Update .env file with AWS_SOLVER_URL"
echo "4. Deploy frontend to Amplify"
