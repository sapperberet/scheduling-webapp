#!/bin/bash
# Quick Start Script for AWS Deployment

echo "=== AWS Deployment Quick Start ==="
echo ""
echo "This script will guide you through deploying your scheduling app to AWS"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found"
    echo "Install from: https://aws.amazon.com/cli/"
    exit 1
else
    echo "✓ AWS CLI installed"
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found"
    echo "Install from: https://www.docker.com/products/docker-desktop"
    exit 1
else
    echo "✓ Docker installed"
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured"
    echo "Run: aws configure"
    exit 1
else
    echo "✓ AWS credentials configured"
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo "  Account ID: $AWS_ACCOUNT_ID"
fi

echo ""
echo "Select deployment option:"
echo "1) Deploy Solver to AWS ECS (Container-based)"
echo "2) Deploy Frontend to AWS Amplify"
echo "3) Both (Full deployment)"
echo "4) Exit"
read -p "Enter choice [1-4]: " choice

case $choice in
    1)
        echo "Deploying solver to AWS ECS..."
        bash deploy-solver-aws.sh
        ;;
    2)
        echo "Frontend deployment to AWS Amplify:"
        echo ""
        echo "Option 1: Via AWS Console (Recommended)"
        echo "1. Go to: https://console.aws.amazon.com/amplify/"
        echo "2. Click 'New app' > 'Host web app'"
        echo "3. Connect your GitHub repository"
        echo "4. Amplify will auto-detect Next.js settings"
        echo "5. Add environment variables:"
        echo "   NEXT_PUBLIC_AWS_SOLVER_URL=<your-alb-url>"
        echo "   NEXT_PUBLIC_AWS_REGION=us-east-1"
        echo "6. Deploy!"
        echo ""
        echo "Option 2: Via Amplify CLI"
        echo "npm install -g @aws-amplify/cli"
        echo "amplify init"
        echo "amplify add hosting"
        echo "amplify publish"
        ;;
    3)
        echo "Full deployment..."
        bash deploy-solver-aws.sh
        echo ""
        echo "Solver deployed! Now deploy frontend via AWS Console:"
        echo "https://console.aws.amazon.com/amplify/"
        ;;
    4)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "=== Deployment Information ==="
echo ""
echo "After deployment, update your .env.local file:"
echo "NEXT_PUBLIC_AWS_SOLVER_URL=https://your-alb-or-api-gateway-url"
echo "NEXT_PUBLIC_AWS_REGION=us-east-1"
echo ""
echo "For detailed instructions, see: AWS_DEPLOYMENT_GUIDE.md"
