# AWS Deployment Checklist

## ✅ Pre-Deployment Checklist

### 1. AWS Account Setup
- [ ] Create AWS account at https://aws.amazon.com
- [ ] Set up billing alerts in CloudWatch
- [ ] Enable MFA (Multi-Factor Authentication) for root account
- [ ] Create IAM user with appropriate permissions
- [ ] Note your AWS Account ID: ________________

### 2. Install Required Tools
- [ ] Install AWS CLI: https://aws.amazon.com/cli/
- [ ] Install Docker Desktop: https://www.docker.com/products/docker-desktop
- [ ] Install Git (if not already installed)
- [ ] Install Node.js 18+ and npm

### 3. Configure AWS CLI
```bash
aws configure
```
Enter:
- [ ] AWS Access Key ID: ________________
- [ ] AWS Secret Access Key: ________________
- [ ] Default region: us-east-1 (or your preferred region)
- [ ] Default output format: json

### 4. Domain Name Setup
- [ ] Have domain name ready
- [ ] Transfer domain to Route 53 OR
- [ ] Get Route 53 nameservers to update at registrar

---

## 🚀 Deployment Steps

### Phase 1: Deploy Solver API to AWS

#### Option A: ECS Fargate (Recommended for long-running jobs)

1. **Build and Push Docker Image**
   ```bash
   # On Windows PowerShell:
   .\deploy-solver-aws.ps1
   
   # On Mac/Linux:
   bash deploy-solver-aws.sh
   ```
   - [ ] ECR repository created
   - [ ] Docker image built successfully
   - [ ] Image pushed to ECR

2. **Create ECS Service**
   - [ ] Go to AWS ECS Console
   - [ ] Create new service from task definition
   - [ ] Configure Application Load Balancer:
     - [ ] Target group health check: `/health`
     - [ ] Health check interval: 30 seconds
   - [ ] Note ALB DNS name: ________________

3. **Configure Security Group**
   - [ ] Allow inbound traffic on port 8000 from ALB
   - [ ] Allow outbound traffic to internet (for dependencies)

4. **Test Solver Endpoint**
   ```bash
   curl https://your-alb-url/health
   ```
   - [ ] Health check returns 200 OK

---

#### Option B: AWS Lambda (Serverless, cost-effective)

1. **Install Dependencies**
   ```bash
   pip install mangum -t package/
   ```
   - [ ] Dependencies installed

2. **Create Deployment Package**
   - [ ] Copy solver code to package/
   - [ ] Create ZIP file
   - [ ] Upload to Lambda (or S3 if >50MB)

3. **Create Lambda Function**
   - [ ] Function created with Python 3.11 runtime
   - [ ] Memory set to 3008 MB (max)
   - [ ] Timeout set to 900 seconds (15 minutes max)
   - [ ] Handler set to `aws_lambda_handler.handler`

4. **Create API Gateway**
   - [ ] REST API created
   - [ ] `/solve` endpoint configured
   - [ ] CORS enabled
   - [ ] API deployed to `prod` stage
   - [ ] Note API URL: ________________

---

### Phase 2: Deploy Frontend to AWS

#### Option A: AWS Amplify (Recommended)

1. **Connect Repository**
   - [ ] Go to AWS Amplify Console
   - [ ] Click "New app" → "Host web app"
   - [ ] Connect GitHub/GitLab repository
   - [ ] Select branch: `master`

2. **Configure Build Settings**
   Amplify auto-detects Next.js. Verify build settings:
   - [ ] Build command: `npm run build`
   - [ ] Build output: `.next`
   - [ ] Node version: 18

3. **Add Environment Variables**
   In Amplify Console → Environment variables:
   ```
   NEXT_PUBLIC_AWS_SOLVER_URL=https://your-alb-or-api-gateway-url
   NEXT_PUBLIC_AWS_REGION=us-east-1
   NEXT_PUBLIC_AWS_API_KEY=your-api-key (if using API Gateway with key)
   ```
   - [ ] Environment variables added

4. **Deploy**
   - [ ] First deployment successful
   - [ ] Note Amplify URL: ________________

5. **Custom Domain (Optional)**
   - [ ] Add custom domain in Amplify
   - [ ] SSL certificate auto-provisioned
   - [ ] DNS records auto-created in Route 53

---

#### Option B: S3 + CloudFront

1. **Build Static Export**
   ```bash
   npm run build
   npm run export  # If using static export
   ```
   - [ ] Build successful

2. **Create S3 Bucket**
   ```bash
   aws s3 mb s3://your-domain-name
   aws s3 sync .next s3://your-domain-name
   ```
   - [ ] S3 bucket created
   - [ ] Files uploaded

3. **Create CloudFront Distribution**
   - [ ] Origin set to S3 bucket
   - [ ] HTTPS redirect enabled
   - [ ] Custom domain configured
   - [ ] SSL certificate from ACM
   - [ ] Note CloudFront URL: ________________

---

### Phase 3: Configure Domain & DNS

1. **Route 53 Hosted Zone**
   - [ ] Hosted zone created for your domain
   - [ ] Nameservers updated at registrar (if not using Route 53)
   - [ ] Wait for DNS propagation (up to 48 hours)

2. **DNS Records**
   - [ ] A record for apex domain (@) → CloudFront/Amplify
   - [ ] A record for www → CloudFront/Amplify
   - [ ] A record for api.your-domain.com → ALB (if using ECS)
   - [ ] SSL certificate validated

3. **Test DNS**
   ```bash
   nslookup your-domain.com
   nslookup api.your-domain.com
   ```
   - [ ] DNS resolving correctly

---

### Phase 4: Storage (S3 for Results)

1. **Create S3 Bucket for Results**
   ```bash
   aws s3 mb s3://scheduling-results-your-domain
   ```
   - [ ] Bucket created

2. **Configure CORS**
   - [ ] CORS policy added (see guide)
   - [ ] Bucket policy for solver access

3. **Update Solver to Use S3**
   - [ ] IAM role for ECS task with S3 permissions
   - [ ] Environment variable `S3_BUCKET` set
   - [ ] Solver code updated to write to S3

---

## 🧪 Testing

### Test Solver API
```bash
# Health check
curl https://api.your-domain.com/health

# Test solve endpoint
curl -X POST https://api.your-domain.com/solve \
  -H "Content-Type: application/json" \
  -d @test-case.json
```
- [ ] Health endpoint works
- [ ] Solve endpoint accepts requests
- [ ] Results returned successfully

### Test Frontend
- [ ] Visit https://your-domain.com
- [ ] Can load sample data
- [ ] Can run optimization with AWS cloud solver
- [ ] Results download successfully
- [ ] Calendar displays correctly

---

## 📊 Monitoring & Optimization

### CloudWatch
- [ ] Set up CloudWatch dashboard
- [ ] Enable ECS/Lambda logging
- [ ] Create alarms:
  - [ ] High CPU usage
  - [ ] High memory usage
  - [ ] API errors
  - [ ] High costs

### Cost Optimization
- [ ] Review AWS Cost Explorer
- [ ] Set up budget alerts
- [ ] Consider Reserved Instances (for ECS if 24/7)
- [ ] Enable S3 lifecycle policies for old results

---

## 🔒 Security Hardening

- [ ] Enable AWS WAF on CloudFront/ALB
- [ ] Implement API authentication (Cognito or API Keys)
- [ ] Rotate IAM access keys regularly
- [ ] Enable CloudTrail for audit logging
- [ ] Review security group rules (least privilege)
- [ ] Enable S3 bucket encryption
- [ ] Set up AWS Secrets Manager for sensitive data

---

## 📝 Documentation

- [ ] Update README with deployment info
- [ ] Document environment variables
- [ ] Create runbook for common issues
- [ ] Document rollback procedure
- [ ] Share credentials securely with team (AWS Secrets Manager)

---

## ✅ Post-Deployment Checklist

- [ ] Application accessible at custom domain
- [ ] SSL certificate valid
- [ ] AWS cloud solver working
- [ ] Results saved to S3
- [ ] Monitoring and alerts configured
- [ ] Backup strategy in place
- [ ] Team trained on deployment process
- [ ] Documentation updated

---

## 🆘 Troubleshooting

### Solver Returns 500 Error
1. Check CloudWatch logs
2. Verify environment variables
3. Check IAM permissions for S3 access
4. Increase Lambda timeout/memory

### Frontend Can't Connect to Solver
1. Verify CORS configuration
2. Check security group rules
3. Verify API URL in environment variables
4. Test solver endpoint directly with curl

### High AWS Costs
1. Check CloudWatch metrics for high usage
2. Consider Lambda for variable workload
3. Review data transfer costs
4. Enable S3 lifecycle policies
5. Use CloudFront caching effectively

---

## 📞 Support Resources

- AWS Documentation: https://docs.aws.amazon.com
- AWS Support: https://console.aws.amazon.com/support/
- Community Forums: https://repost.aws/
- Your deployment guide: `AWS_DEPLOYMENT_GUIDE.md`

---

## Cost Estimate Summary

**Serverless (Lambda + Amplify):**
- ~$10-50/month for low-medium usage

**Container-based (ECS + Amplify):**
- ~$60-150/month for 24/7 availability

**Add-ons:**
- Route 53: ~$0.50/month per hosted zone
- S3 storage: ~$0.023/GB per month
- Data transfer: varies by usage

---

**Deployment Date:** ________________
**Deployed By:** ________________
**AWS Account ID:** ________________
**Region:** ________________
**Domain:** ________________
