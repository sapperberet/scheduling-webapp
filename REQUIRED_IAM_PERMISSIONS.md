# Required IAM Permissions for Complete Deployment

This document lists ALL permissions needed to deploy and manage the scheduling application on AWS.

---

## 📋 Complete Permission List

### Core Deployment Permissions

#### 1. **Amazon ECR (Elastic Container Registry)**
For storing Docker images of the solver.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:CreateRepository",
        "ecr:DescribeRepositories",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:ListImages",
        "ecr:DescribeImages"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: To push Docker images to AWS container registry

**AWS Managed Policy**: `AmazonEC2ContainerRegistryFullAccess`

---

#### 2. **Amazon ECS (Elastic Container Service)**
For running the solver containers.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:CreateCluster",
        "ecs:DescribeClusters",
        "ecs:RegisterTaskDefinition",
        "ecs:DeregisterTaskDefinition",
        "ecs:DescribeTaskDefinition",
        "ecs:ListTaskDefinitions",
        "ecs:CreateService",
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:ListServices",
        "ecs:RunTask",
        "ecs:StopTask",
        "ecs:DescribeTasks",
        "ecs:ListTasks",
        "ecs:ListClusters"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: To create and manage ECS clusters and services

**AWS Managed Policy**: `AmazonECS_FullAccess`

---

#### 3. **AWS Lambda** (If using serverless option)
For running solver as Lambda function.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:ListFunctions",
        "lambda:DeleteFunction",
        "lambda:InvokeFunction",
        "lambda:PublishVersion",
        "lambda:CreateAlias",
        "lambda:UpdateAlias"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: If you choose Lambda instead of ECS

**AWS Managed Policy**: `AWSLambda_FullAccess`

---

#### 4. **Amazon S3 (Simple Storage Service)**
For storing result files and solver outputs.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketCors",
        "s3:PutBucketCors",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObjectVersion",
        "s3:PutBucketPolicy",
        "s3:GetBucketPolicy",
        "s3:PutBucketVersioning",
        "s3:GetBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::scheduling-results-*",
        "arn:aws:s3:::scheduling-results-*/*"
      ]
    }
  ]
}
```

**Why**: To store optimization results and Excel exports

**AWS Managed Policy**: `AmazonS3FullAccess`

---

#### 5. **AWS IAM (Identity and Access Management)**
For creating service roles and managing permissions.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:GetRole",
        "iam:PassRole",
        "iam:DeleteRole",
        "iam:PutRolePolicy",
        "iam:GetRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:CreateAccessKey",
        "iam:ListAccessKeys",
        "iam:DeleteAccessKey"
      ],
      "Resource": [
        "arn:aws:iam::*:role/ecsTaskExecutionRole",
        "arn:aws:iam::*:role/schedulingSolverTaskRole",
        "arn:aws:iam::*:user/${aws:username}"
      ]
    }
  ]
}
```

**Why**: To create roles for ECS tasks and Lambda functions

**AWS Managed Policy**: `IAMFullAccess` (or minimum: `IAMReadOnlyAccess` + specific permissions)

---

#### 6. **Amazon CloudWatch**
For monitoring, logging, and alarms.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:GetLogEvents",
        "logs:FilterLogEvents",
        "cloudwatch:PutMetricData",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:ListMetrics",
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DescribeAlarms"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: For application logs and monitoring

**AWS Managed Policy**: `CloudWatchLogsFullAccess`

---

#### 7. **Amazon EC2** (For ECS and networking)
For VPC, security groups, and load balancers.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:CreateSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DescribeAvailabilityZones"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: For networking configuration of ECS tasks

**AWS Managed Policy**: `AmazonEC2ReadOnlyAccess` (minimum)

---

#### 8. **Elastic Load Balancing**
For Application Load Balancer in front of ECS.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:CreateLoadBalancer",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DeleteLoadBalancer",
        "elasticloadbalancing:CreateTargetGroup",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DeleteTargetGroup",
        "elasticloadbalancing:CreateListener",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:ModifyListener",
        "elasticloadbalancing:RegisterTargets",
        "elasticloadbalancing:DeregisterTargets",
        "elasticloadbalancing:DescribeTargetHealth"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: For load balancer in front of solver API

**AWS Managed Policy**: `ElasticLoadBalancingFullAccess`

---

#### 9. **Amazon API Gateway** (If using Lambda)
For REST API in front of Lambda function.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "apigateway:POST",
        "apigateway:GET",
        "apigateway:PUT",
        "apigateway:DELETE",
        "apigateway:PATCH"
      ],
      "Resource": "arn:aws:apigateway:*::/*"
    }
  ]
}
```

**Why**: If using Lambda, needs API Gateway

**AWS Managed Policy**: `AmazonAPIGatewayAdministrator`

---

#### 10. **AWS Amplify**
For hosting the Next.js frontend.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "amplify:CreateApp",
        "amplify:UpdateApp",
        "amplify:DeleteApp",
        "amplify:GetApp",
        "amplify:ListApps",
        "amplify:CreateBranch",
        "amplify:UpdateBranch",
        "amplify:GetBranch",
        "amplify:ListBranches",
        "amplify:StartDeployment",
        "amplify:CreateDomainAssociation",
        "amplify:UpdateDomainAssociation"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: For deploying the frontend

**AWS Managed Policy**: `AdministratorAccess-Amplify`

---

#### 11. **Amazon Route 53** (For custom domain)
For DNS management.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "route53:CreateHostedZone",
        "route53:GetHostedZone",
        "route53:ListHostedZones",
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets",
        "route53:GetChange"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: For custom domain setup

**AWS Managed Policy**: `AmazonRoute53FullAccess`

---

#### 12. **AWS Certificate Manager (ACM)**
For SSL certificates.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "acm:RequestCertificate",
        "acm:DescribeCertificate",
        "acm:ListCertificates",
        "acm:AddTagsToCertificate"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: For HTTPS certificates

**AWS Managed Policy**: `AWSCertificateManagerFullAccess`

---

#### 13. **AWS CloudFormation** (Optional but helpful)
For infrastructure as code.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DeleteStack",
        "cloudformation:ListStacks"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: Optional - for automated infrastructure deployment

**AWS Managed Policy**: `AWSCloudFormationFullAccess`

---

#### 14. **AWS STS (Security Token Service)**
For verifying credentials.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}
```

**Why**: For testing credentials with `aws sts get-caller-identity`

**Automatically included in most policies**

---

## 🎯 Simplified: Use These Managed Policies

Instead of creating custom policies, ask your admin to attach these **AWS Managed Policies**:

### ✅ Minimum Required (Core Deployment):
1. **`AmazonEC2ContainerRegistryFullAccess`** - Docker images
2. **`AmazonECS_FullAccess`** - Container service
3. **`AmazonS3FullAccess`** - File storage
4. **`CloudWatchLogsFullAccess`** - Logging
5. **`IAMFullAccess`** OR at minimum:
   - `IAMReadOnlyAccess` + permission to create service roles

### ✅ Recommended (Full Features):
6. **`ElasticLoadBalancingFullAccess`** - Load balancer
7. **`AdministratorAccess-Amplify`** - Frontend hosting
8. **`AmazonRoute53FullAccess`** - Custom domain
9. **`AWSCertificateManagerFullAccess`** - SSL certificates

### ⚡ Alternative: Lambda Instead of ECS:
- Replace `AmazonECS_FullAccess` with `AWSLambda_FullAccess`
- Add `AmazonAPIGatewayAdministrator`

---

## 📧 Email Template for Your Admin

Copy and send this to your AWS administrator:

```
Subject: IAM Permissions Request for Scheduling App Deployment

Hi [Admin Name],

I need to deploy our scheduling application to AWS. Could you please attach the following AWS managed policies to my IAM user account?

Core Permissions (Required):
✅ AmazonEC2ContainerRegistryFullAccess - For Docker image storage
✅ AmazonECS_FullAccess - For running containers
✅ AmazonS3FullAccess - For result file storage
✅ CloudWatchLogsFullAccess - For application logging
✅ IAMFullAccess - For creating service roles (or minimum: role creation permissions)

Additional Permissions (Recommended):
✅ ElasticLoadBalancingFullAccess - For load balancer
✅ AdministratorAccess-Amplify - For frontend deployment
✅ AmazonRoute53FullAccess - For DNS/domain setup
✅ AWSCertificateManagerFullAccess - For SSL certificates

Additionally, please grant permission to:
✅ Create access keys for my IAM user (iam:CreateAccessKey)

Deployment documentation: AWS_DEPLOYMENT_GUIDE.md
Full permissions list: REQUIRED_IAM_PERMISSIONS.md

My IAM Username: [your-username]
AWS Account ID: [your-account-id]

Thanks!
[Your Name]
```

---

## 🔒 Security Considerations

### Least Privilege Approach

If your admin prefers minimal permissions, they can create a custom policy with only:

**Minimum Viable Permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:*",
        "ecs:*",
        "s3:*",
        "logs:*",
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:PassRole",
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups"
      ],
      "Resource": "*"
    }
  ]
}
```

This is more restrictive but sufficient for basic deployment.

---

## 🧪 Testing Your Permissions

After your admin grants permissions, test them:

### Test 1: Basic AWS Access
```powershell
aws sts get-caller-identity
```
Should show your user info.

### Test 2: ECR Access
```powershell
aws ecr describe-repositories
```
Should not give "Access Denied".

### Test 3: ECS Access
```powershell
aws ecs list-clusters
```
Should work (even if list is empty).

### Test 4: S3 Access
```powershell
aws s3 ls
```
Should list your buckets (or empty list).

### Test 5: IAM Access
```powershell
aws iam list-attached-user-policies --user-name YOUR_USERNAME
```
Should show your attached policies.

---

## 🚨 Common Permission Issues

### Issue: "User is not authorized to perform: ecs:CreateCluster"
**Fix**: Need `AmazonECS_FullAccess` policy

### Issue: "User is not authorized to perform: ecr:CreateRepository"
**Fix**: Need `AmazonEC2ContainerRegistryFullAccess` policy

### Issue: "User is not authorized to perform: iam:CreateRole"
**Fix**: Need IAM permissions (at minimum `iam:CreateRole`, `iam:AttachRolePolicy`)

### Issue: "Access Denied" on S3
**Fix**: Need `AmazonS3FullAccess` or specific bucket permissions

### Issue: Cannot create access keys
**Fix**: Admin needs to grant `iam:CreateAccessKey` permission

---

## 📊 Permission Levels

### Level 1: Read-Only (Can't Deploy)
- View AWS resources
- Check logs
- Not sufficient for deployment

### Level 2: Developer (Minimum for Deployment) ⭐
- Create/update ECS services
- Push Docker images to ECR
- Read/write S3
- View CloudWatch logs
- Create service roles

### Level 3: Full Access (Recommended)
- Everything in Level 2
- Create load balancers
- Manage Route 53
- Deploy to Amplify
- Full infrastructure management

### Level 4: Administrator (Not Recommended)
- Full AWS access
- Not necessary for this project
- Security risk

**Recommendation**: Request Level 2 or Level 3 permissions.

---

## 🎯 Quick Reference by Deployment Method

### If Deploying with ECS (Container):
```
✅ AmazonEC2ContainerRegistryFullAccess
✅ AmazonECS_FullAccess
✅ AmazonS3FullAccess
✅ CloudWatchLogsFullAccess
✅ IAMFullAccess (or role creation permissions)
✅ ElasticLoadBalancingFullAccess
✅ AmazonEC2ReadOnlyAccess
```

### If Deploying with Lambda (Serverless):
```
✅ AmazonEC2ContainerRegistryFullAccess (for packaging)
✅ AWSLambda_FullAccess
✅ AmazonAPIGatewayAdministrator
✅ AmazonS3FullAccess
✅ CloudWatchLogsFullAccess
✅ IAMFullAccess (or role creation permissions)
```

### For Frontend (Amplify):
```
✅ AdministratorAccess-Amplify
✅ AmazonRoute53FullAccess (for custom domain)
✅ AWSCertificateManagerFullAccess (for SSL)
```

---

## 📝 Summary Checklist

Before starting deployment, verify you have:

- [ ] Access Key ID and Secret Access Key created
- [ ] AWS CLI configured (`aws configure`)
- [ ] Credentials tested (`aws sts get-caller-identity`)
- [ ] ECR permissions (for Docker images)
- [ ] ECS or Lambda permissions (for solver)
- [ ] S3 permissions (for results)
- [ ] CloudWatch permissions (for logs)
- [ ] IAM permissions (for service roles)
- [ ] Amplify permissions (for frontend - can do later)
- [ ] Route 53 permissions (for domain - optional)

**Minimum to start**: First 7 items checked ✅

---

## 🆘 If Admin Says "Too Many Permissions"

Explain the need:

1. **ECR**: Store Docker images securely
2. **ECS/Lambda**: Run the optimization solver
3. **S3**: Store results for users to download
4. **CloudWatch**: Debug issues and monitor performance
5. **IAM**: Create secure roles for services
6. **ALB**: Provide HTTPS endpoint for security
7. **Amplify**: Host the website professionally

All are industry-standard for production web applications on AWS.

---

## 📞 Getting Help

**Check your current permissions:**
```powershell
aws iam list-attached-user-policies --user-name YOUR_USERNAME
aws iam list-user-policies --user-name YOUR_USERNAME
```

**If you lack permissions:**
1. Share this document with your admin
2. Highlight the specific permission you need
3. Explain which deployment step requires it

---

**Ready to request permissions?** Use the email template above! 🚀
