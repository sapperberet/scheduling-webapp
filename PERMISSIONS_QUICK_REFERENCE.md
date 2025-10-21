# IAM Permissions Quick Reference

## 🎯 Simple Summary: What Permissions Do You Need?

---

## Option 1: Simple Request (Recommended)

**Just ask your admin for these AWS Managed Policies:**

```
✅ AmazonEC2ContainerRegistryFullAccess
✅ AmazonECS_FullAccess
✅ AmazonS3FullAccess
✅ CloudWatchLogsFullAccess
✅ IAMFullAccess (or permission to create roles)
✅ ElasticLoadBalancingFullAccess
✅ AdministratorAccess-Amplify
✅ AmazonRoute53FullAccess
✅ AWSCertificateManagerFullAccess
```

Plus: Permission to create access keys for your user.

---

## Option 2: Minimal (Just to Get Started)

**Absolute minimum to deploy the solver:**

```
✅ AmazonEC2ContainerRegistryFullAccess (Docker images)
✅ AmazonECS_FullAccess (Run containers)
✅ AmazonS3FullAccess (Store results)
✅ CloudWatchLogsFullAccess (View logs)
✅ Permission to create IAM service roles
```

You can add more permissions later for frontend/domain.

---

## Visual: What Each Permission Does

```
┌─────────────────────────────────────────────────────┐
│             YOUR SCHEDULING APP                     │
└─────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Frontend   │  │    Solver    │  │   Storage    │
│  (Amplify)   │  │    (ECS)     │  │     (S3)     │
└──────────────┘  └──────────────┘  └──────────────┘
       │                 │                  │
       │                 │                  │
    Need:            Need:              Need:
  - Amplify        - ECS               - S3
  - Route53        - ECR               
  - ACM (SSL)      - CloudWatch        
                   - IAM (roles)       
```

---

## By Deployment Stage

### Stage 1: Deploy Solver (30 min)
**Permissions needed:**
- ✅ ECR (push Docker images)
- ✅ ECS (run containers)
- ✅ IAM (create service roles)
- ✅ CloudWatch (view logs)
- ✅ EC2 (networking - minimal)
- ✅ ELB (load balancer)

**Managed policies:**
- `AmazonEC2ContainerRegistryFullAccess`
- `AmazonECS_FullAccess`
- `IAMFullAccess`
- `CloudWatchLogsFullAccess`
- `ElasticLoadBalancingFullAccess`

### Stage 2: Deploy Frontend (20 min)
**Permissions needed:**
- ✅ Amplify (host website)
- ✅ S3 (can do via Amplify console - no CLI needed)

**Managed policies:**
- `AdministratorAccess-Amplify`

### Stage 3: Custom Domain (10 min)
**Permissions needed:**
- ✅ Route 53 (DNS)
- ✅ ACM (SSL certificate)

**Managed policies:**
- `AmazonRoute53FullAccess`
- `AWSCertificateManagerFullAccess`

---

## Testing: Do You Have the Right Permissions?

```powershell
# Test 1: Basic access
aws sts get-caller-identity
# ✅ Should show your username and account

# Test 2: ECR access
aws ecr describe-repositories
# ✅ Should work (even if empty)

# Test 3: ECS access
aws ecs list-clusters
# ✅ Should work (even if empty)

# Test 4: S3 access
aws s3 ls
# ✅ Should work (even if empty)

# Test 5: View your permissions
aws iam list-attached-user-policies --user-name YOUR_USERNAME
# ✅ Should show attached policies
```

If all 5 tests pass, you're ready to deploy! ✅

---

## What Each Service Does

| Service | What It's For | Permission Policy |
|---------|--------------|-------------------|
| **ECR** | Store Docker images | `AmazonEC2ContainerRegistryFullAccess` |
| **ECS** | Run solver containers | `AmazonECS_FullAccess` |
| **S3** | Store Excel results | `AmazonS3FullAccess` |
| **CloudWatch** | View logs/errors | `CloudWatchLogsFullAccess` |
| **IAM** | Create service roles | `IAMFullAccess` |
| **ELB** | HTTPS endpoint | `ElasticLoadBalancingFullAccess` |
| **Amplify** | Host frontend | `AdministratorAccess-Amplify` |
| **Route 53** | Custom domain DNS | `AmazonRoute53FullAccess` |
| **ACM** | SSL certificate | `AWSCertificateManagerFullAccess` |

---

## Copy-Paste for Your Admin

```
Hi [Admin],

Please attach these AWS managed policies to my IAM user:

Core (Required):
- AmazonEC2ContainerRegistryFullAccess
- AmazonECS_FullAccess
- AmazonS3FullAccess
- CloudWatchLogsFullAccess
- IAMFullAccess

Additional (Recommended):
- ElasticLoadBalancingFullAccess
- AdministratorAccess-Amplify
- AmazonRoute53FullAccess
- AWSCertificateManagerFullAccess

Also grant: iam:CreateAccessKey permission

Thanks!
```

---

## Alternative: If Admin Prefers Custom Policy

Share the complete JSON from: `REQUIRED_IAM_PERMISSIONS.md`

---

## FAQ

**Q: Why so many permissions?**  
A: Each AWS service requires its own permissions. This is standard for production deployments.

**Q: Can I deploy with fewer permissions?**  
A: Yes, start with ECR + ECS + S3 + CloudWatch. Add others later.

**Q: What if admin says no to IAMFullAccess?**  
A: Ask for minimum: `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole`

**Q: Do I need all of these forever?**  
A: No. After initial deployment, you only need ECS + S3 + CloudWatch for daily operations.

**Q: What about costs?**  
A: Permissions don't cost anything. Only the services you use cost money.

---

## Summary

**To deploy solver:**
- 5 core policies (ECR, ECS, S3, CloudWatch, IAM)

**To deploy frontend:**  
- 1 additional policy (Amplify)

**To add custom domain:**
- 2 additional policies (Route 53, ACM)

**Total:** 8 managed policies (or 5 to start)

---

**See detailed documentation:** `REQUIRED_IAM_PERMISSIONS.md`

**Ready to request?** Copy the email template above! 📧
