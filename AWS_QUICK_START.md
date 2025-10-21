# 🚀 AWS Deployment Quick Start

This guide will get your scheduling application running on AWS with your custom domain in under 1 hour.

## 📋 What You'll Get

✅ **Frontend**: Your Next.js app hosted on AWS Amplify with your custom domain  
✅ **Solver API**: Python FastAPI solver running on AWS (ECS or Lambda)  
✅ **Storage**: S3 for result files  
✅ **Domain**: Custom domain with SSL certificate  
✅ **Scalability**: Auto-scaling based on demand  

---

## ⚡ Quick Start (30 minutes)

### Step 1: Prerequisites (5 min)

1. **Create AWS Account**: https://aws.amazon.com (Free tier available)

2. **Check IAM Permissions**: 
   
   ⚠️ **IAM Users**: You need specific permissions to deploy!
   
   📖 **Quick reference**: `PERMISSIONS_QUICK_REFERENCE.md`  
   📖 **Complete list**: `REQUIRED_IAM_PERMISSIONS.md`  
   📖 **IAM user guide**: `IAM_USER_SETUP.md`
   
   **Minimum required policies:**
   - `AmazonEC2ContainerRegistryFullAccess` (Docker)
   - `AmazonECS_FullAccess` (Containers)
   - `AmazonS3FullAccess` (Storage)
   - `CloudWatchLogsFullAccess` (Logs)
   - `IAMFullAccess` (Service roles)
   
   Ask your AWS admin to attach these policies to your IAM user.

3. **Install AWS CLI**: 
   - Windows: Download from https://awscli.amazonaws.com/AWSCLIV2.msi
   - Mac: `brew install awscli`

4. **Install Docker**: https://www.docker.com/products/docker-desktop

5. **Get AWS Access Keys**:
   
   ⚠️ **Important**: If you're an IAM user with username/password, you need to create Access Keys first!
   
   📖 **See detailed guide**: `GET_AWS_ACCESS_KEYS.md`
   
   Quick steps:
   - Log in to AWS Console with your IAM username/password
   - Click your username (top-right) → **"Security credentials"**
   - Scroll to **"Access keys"** → **"Create access key"**
   - Select use case: **"CLI"**
   - **Download the .csv file** ⬅️ CRITICAL!
   - Keep these secret! Never commit to Git!

5. **Configure AWS CLI**:
   
   **Windows (PowerShell):**
   ```powershell
   # Option 1: Use full path (if AWS CLI not in PATH)
   & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' configure
   
   # Option 2: Add to PATH (one-time setup)
   $env:Path += ";C:\Program Files\Amazon\AWSCLIV2"
   aws configure
   ```
   
   **Mac/Linux:**
   ```bash
   aws configure
   ```
   
   Enter the credentials from the .csv file:
   - **AWS Access Key ID**: AKIA... (from .csv)
   - **AWS Secret Access Key**: (from .csv - long random string)
   - **Default region**: `us-east-1`
   - **Default output format**: `json`
   
   Test it works:
   
   **Windows (PowerShell):**
   ```powershell
   & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' sts get-caller-identity
   ```
   
   **Mac/Linux:**
   ```bash
   aws sts get-caller-identity
   ```

### Step 2: Deploy Solver to AWS (15 min)

**Option A: PowerShell (Windows)**
```powershell
.\deploy-solver-aws.ps1
```

**Option B: Bash (Mac/Linux)**
```bash
chmod +x deploy-solver-aws.sh
./deploy-solver-aws.sh
```

This script will:
- Create ECR repository
- Build Docker image
- Push to AWS
- Set up ECS cluster
- Create task definition

**Note the ALB/API Gateway URL** that's displayed at the end!

### Step 3: Deploy Frontend to Amplify (10 min)

1. Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify/)
2. Click **"New app"** → **"Host web app"**
3. Connect your **GitHub** repository
4. Select branch: `master`
5. Add **Environment Variables**:
   ```
   NEXT_PUBLIC_AWS_SOLVER_URL=https://your-solver-url-from-step-2
   NEXT_PUBLIC_AWS_REGION=us-east-1
   ```
6. Click **"Save and Deploy"**
7. Wait 5-10 minutes for deployment

### Step 4: Configure Custom Domain (Optional, 5 min)

In Amplify Console:
1. Click **"Domain management"**
2. Add your domain name
3. Amplify will:
   - Create SSL certificate
   - Set up CloudFront
   - Configure DNS (if using Route 53)

**If your domain is NOT in Route 53:**
- Copy the CNAME records shown
- Add them to your domain registrar's DNS settings
- Wait 5-60 minutes for DNS propagation

---

## 🎉 You're Done!

Visit your application:
- **Amplify URL**: `https://master.xxxxx.amplifyapp.com`
- **Custom Domain** (if configured): `https://your-domain.com`

Test the AWS Cloud solver:
1. Load sample data
2. Select month and click "Apply"
3. Click **"AWS Cloud"** button
4. Watch optimization run in AWS!

---

## 💰 Cost Estimate

### Free Tier (First 12 months)
- Amplify: 1000 build minutes free
- Lambda: 1M requests free
- ECS: Limited free tier
- S3: 5GB storage free

### After Free Tier
- **Serverless (Lambda)**: $10-30/month for typical usage
- **Container (ECS)**: $40-80/month for 24/7 availability
- **Domain**: $12/year (if registered through Route 53)

**Tip**: Start with Lambda to minimize costs, upgrade to ECS if you need longer computation times.

---

## 🔧 Configuration Options

### Use Lambda Instead of ECS (Lower cost)

If you chose ECS but want to try Lambda:

1. Create Lambda function manually:
   - Runtime: Python 3.11
   - Memory: 3008 MB
   - Timeout: 900 seconds (15 min max)
   - Upload deployment package (see guide)

2. Create API Gateway:
   - REST API
   - POST /solve endpoint
   - Enable CORS

3. Update environment variable:
   ```
   NEXT_PUBLIC_AWS_SOLVER_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com/prod
   ```

### Add API Authentication

For production, add API key authentication:

1. In API Gateway:
   - Create API key
   - Create Usage Plan
   - Associate with your API

2. Update environment variable:
   ```
   NEXT_PUBLIC_AWS_API_KEY=your-api-key-here
   ```

---

## 📊 Monitoring

### CloudWatch Dashboard

1. Go to [CloudWatch Console](https://console.aws.amazon.com/cloudwatch/)
2. Create dashboard
3. Add widgets for:
   - ECS/Lambda invocations
   - Response times
   - Error rates
   - Costs

### Set Up Billing Alerts

1. Go to [Billing Console](https://console.aws.amazon.com/billing/)
2. Preferences → **Enable billing alerts**
3. Create CloudWatch alarm:
   - Threshold: $50/month (adjust as needed)
   - Email notification

---

## 🐛 Troubleshooting

### "AWS solver not configured" error

**Solution**: Add environment variable in Amplify Console:
```
NEXT_PUBLIC_AWS_SOLVER_URL=https://your-solver-url
```
Then redeploy.

### Solver returns 500 error

**Check**:
1. CloudWatch logs for ECS task or Lambda function
2. IAM permissions (task role needs S3 access if using storage)
3. Security group allows port 8000 (for ECS)

### Frontend can't connect to solver

**Check**:
1. CORS is enabled on API Gateway/ALB
2. Security group allows inbound traffic
3. URL in environment variable is correct (include https://)

### High AWS costs

**Solutions**:
- Use Lambda instead of ECS for variable workload
- Enable S3 lifecycle policies (delete old results after 90 days)
- Use CloudFront caching
- Set up auto-scaling limits

---

## 📚 Additional Resources

- **Full Deployment Guide**: `AWS_DEPLOYMENT_GUIDE.md`
- **Deployment Checklist**: `AWS_DEPLOYMENT_CHECKLIST.md`
- **AWS Documentation**: https://docs.aws.amazon.com
- **Support**: https://console.aws.amazon.com/support/

---

## 🔄 Updates & Redeployment

### Update Solver Code

1. Make changes to `fastapi_solver_service.py`
2. Run deployment script again:
   ```bash
   ./deploy-solver-aws.sh
   ```
3. ECS will automatically deploy new version

### Update Frontend Code

1. Commit changes to GitHub
2. Amplify automatically rebuilds and deploys
3. No manual action needed!

---

## 🎯 Next Steps

Once your app is running on AWS:

1. ✅ Test with real scheduling data
2. ✅ Set up automated backups
3. ✅ Configure monitoring and alerts
4. ✅ Add user authentication (Cognito)
5. ✅ Implement API rate limiting
6. ✅ Set up CI/CD pipeline

---

## 🆘 Need Help?

- **AWS Issues**: Check CloudWatch logs first
- **Deployment Errors**: See `AWS_DEPLOYMENT_CHECKLIST.md`
- **Cost Questions**: Use AWS Cost Explorer
- **Technical Support**: AWS Support (free for billing, paid for technical)

---

**Deployment Date**: _________________  
**Deployed By**: _________________  
**AWS Account ID**: _________________  
**Domain**: _________________  
**Solver URL**: _________________  

---

## ⚠️ Important Security Notes

1. **Never commit AWS credentials** to Git
2. **Use IAM roles** instead of access keys when possible
3. **Enable MFA** on AWS root account
4. **Rotate access keys** every 90 days
5. **Review permissions** regularly (use least privilege)
6. **Enable CloudTrail** for audit logging

---

**Happy Deploying! 🚀**
