# AWS Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER'S BROWSER                                 │
│                     https://your-domain.com                             │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             │ HTTPS Request
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        ROUTE 53 (DNS)                                   │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │  your-domain.com        → CloudFront Distribution           │       │
│  │  api.your-domain.com    → Application Load Balancer         │       │
│  └─────────────────────────────────────────────────────────────┘       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
             ┌───────────────┴──────────────┐
             ▼                              ▼
┌─────────────────────────┐    ┌──────────────────────────────────────────┐
│   CLOUDFRONT (CDN)      │    │  APPLICATION LOAD BALANCER               │
│   SSL Certificate       │    │  SSL Certificate                         │
│   Global Edge Caching   │    │  Health Checks                           │
└────────────┬────────────┘    └──────────────┬───────────────────────────┘
             │                                 │
             │                                 │
             ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     AWS AMPLIFY (Frontend)                              │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Next.js Application                                          │      │
│  │  - React Components                                           │      │
│  │  - RunTab with AWS Cloud button                              │      │
│  │  - Calendar UI                                                │      │
│  │  - Provider/Shift Management                                 │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                          │
│  Environment Variables:                                                 │
│  - NEXT_PUBLIC_AWS_SOLVER_URL                                          │
│  - NEXT_PUBLIC_AWS_REGION                                              │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
                              │ API Call (POST /solve)
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   API GATEWAY / ALB                                     │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Endpoint: /solve (POST)                                      │      │
│  │  Endpoint: /health (GET)                                      │      │
│  │  Endpoint: /results/{id} (GET)                               │      │
│  │  CORS: Enabled                                                │      │
│  │  Authentication: API Key (Optional)                           │      │
│  └──────────────────────────────────────────────────────────────┘      │
└─────────────────────────────┬───────────────────────────────────────────┘
                              │
             ┌────────────────┴──────────────┐
             ▼                               ▼
┌──────────────────────────┐    ┌────────────────────────────────────────┐
│  AWS LAMBDA              │    │  AWS ECS FARGATE                       │
│  (Serverless Option)     │    │  (Container Option)                    │
├──────────────────────────┤    ├────────────────────────────────────────┤
│  Runtime: Python 3.11    │    │  CPU: 1 vCPU                           │
│  Memory: 3008 MB (max)   │    │  Memory: 2 GB                          │
│  Timeout: 15 min (max)   │    │  Image: ECR Repository                 │
│  Handler: Mangum         │    │  Auto-scaling: 1-10 tasks              │
│                          │    │  Health Check: /health                 │
│  ┌────────────────────┐  │    │  ┌──────────────────────────────────┐ │
│  │ FastAPI Solver     │  │    │  │  Docker Container                 │ │
│  │ - OR-Tools        │  │    │  │  ┌────────────────────────────┐  │ │
│  │ - Optimization    │  │    │  │  │ FastAPI Solver Service      │  │ │
│  │ - Constraint Sat  │  │    │  │  │ - OR-Tools                  │  │ │
│  │ - Result Gen      │  │    │  │  │ - Complex Optimization      │  │ │
│  └────────────────────┘  │    │  │  │ - Multi-solution Gen        │  │ │
│                          │    │  │  └────────────────────────────┘  │ │
│  Cost: Pay per request   │    │  │                                   │ │
│  $0.20 per 1M requests   │    │  │  Port: 8000                       │ │
│                          │    │  └──────────────────────────────────┘ │
│  Best for:               │    │                                        │
│  - Variable workload     │    │  Cost: ~$40-80/month                  │
│  - Cost optimization     │    │                                        │
│  - Simple cases          │    │  Best for:                            │
│                          │    │  - Long computations (>15 min)        │
│                          │    │  - Consistent workload                │
│                          │    │  - Complex optimizations              │
└──────────┬───────────────┘    └──────────────┬─────────────────────────┘
           │                                   │
           └───────────────┬───────────────────┘
                           │
                           │ Store Results
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        AWS S3 (Storage)                                 │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Bucket: scheduling-results-your-domain                       │      │
│  │                                                               │      │
│  │  Structure:                                                   │      │
│  │    Result_1/                                                  │      │
│  │      ├── calendar.xlsx                                       │      │
│  │      ├── results.json                                        │      │
│  │      └── input_case.json                                     │      │
│  │    Result_2/                                                  │      │
│  │      ├── calendar.xlsx                                       │      │
│  │      └── ...                                                 │      │
│  │                                                               │      │
│  │  Features:                                                    │      │
│  │  - Versioning: Enabled                                       │      │
│  │  - Encryption: AES-256                                       │      │
│  │  - Lifecycle: Delete after 90 days (optional)               │      │
│  │  - CORS: Configured for frontend access                     │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                          │
│  Cost: $0.023 per GB/month                                              │
└─────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                     MONITORING & LOGGING                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  CloudWatch Logs                 CloudWatch Metrics                     │
│  ├── ECS Task Logs              ├── API Response Time                  │
│  ├── Lambda Execution           ├── Error Rate                         │
│  ├── ALB Access Logs            ├── Request Count                      │
│  └── Application Errors         └── CPU/Memory Usage                   │
│                                                                          │
│  CloudWatch Alarms                                                      │
│  ├── High CPU Usage (>80%)                                             │
│  ├── High Error Rate (>5%)                                             │
│  ├── Cost Threshold ($100/month)                                       │
│  └── Health Check Failures                                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                          SECURITY LAYERS                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. AWS WAF (Web Application Firewall)                                 │
│     - DDoS Protection                                                   │
│     - Rate Limiting                                                     │
│     - SQL Injection Prevention                                          │
│                                                                          │
│  2. Security Groups                                                     │
│     - ECS: Allow 8000 from ALB only                                    │
│     - ALB: Allow 443 from Internet                                     │
│     - S3: Private, access via IAM roles                                │
│                                                                          │
│  3. IAM Roles                                                           │
│     - ECS Task Role: S3 read/write                                     │
│     - Lambda Execution Role: CloudWatch logs                           │
│     - Amplify Role: Build and deploy                                   │
│                                                                          │
│  4. SSL/TLS                                                             │
│     - ACM Certificates (Free)                                          │
│     - TLS 1.2+ Only                                                    │
│     - Auto-renewal                                                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘


DATA FLOW:
──────────

1. User clicks "AWS Cloud" button
2. Frontend sends case data to api.your-domain.com/solve
3. ALB routes to ECS task or Lambda function
4. Solver processes optimization (10 sec - 4 hours)
5. Results saved to S3
6. Response sent back to frontend with S3 URLs
7. Frontend displays results and provides download links
8. User downloads Excel file from S3


DEPLOYMENT FLOW:
────────────────

┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌────────────┐
│   GitHub    │────▶│ AWS Amplify  │────▶│ CloudFront │────▶│   Users    │
│  (master)   │     │ (Auto Build) │     │   (CDN)    │     │            │
└─────────────┘     └──────────────┘     └────────────┘     └────────────┘
                           │
                           │ Environment Variables
                           ▼
                    ┌──────────────┐
                    │ Solver URL   │
                    │ AWS Region   │
                    │ API Key      │
                    └──────────────┘

┌─────────────┐     ┌──────────────┐     ┌────────────┐     ┌────────────┐
│ Local Code  │────▶│ Docker Build │────▶│  AWS ECR   │────▶│  ECS Task  │
│   (Solver)  │     │              │     │  (Images)  │     │  Running   │
└─────────────┘     └──────────────┘     └────────────┘     └────────────┘


COST BREAKDOWN (Monthly):
─────────────────────────

Serverless Option:
├── Amplify Hosting          $5-15
├── Lambda (1000 runs)       $2-5
├── API Gateway              $3-7
├── S3 Storage (10GB)        $0.23
├── Data Transfer            $5-10
└── Total:                   ~$15-40/month

Container Option:
├── Amplify Hosting          $5-15
├── ECS Fargate (24/7)       $30-50
├── ALB                      $16
├── S3 Storage (10GB)        $0.23
├── Data Transfer            $10-20
└── Total:                   ~$60-100/month
```

---

## Scalability Patterns

### Horizontal Scaling (ECS)
```
Light Load:     [Task 1]
                
Medium Load:    [Task 1] [Task 2] [Task 3]

Heavy Load:     [Task 1] [Task 2] [Task 3]
                [Task 4] [Task 5] [Task 6]
                [Task 7] [Task 8] [Task 9]
```

### Auto-scaling Triggers
- CPU > 70% → Add task
- CPU < 30% → Remove task
- Min tasks: 1
- Max tasks: 10

---

## High Availability

```
Region: us-east-1
├── Availability Zone A
│   ├── ECS Task 1
│   └── ALB Target 1
│
├── Availability Zone B
│   ├── ECS Task 2
│   └── ALB Target 2
│
└── Availability Zone C
    ├── ECS Task 3
    └── ALB Target 3

If one zone fails → Traffic routes to other zones automatically
```

---

## Backup & Disaster Recovery

```
Production Data → S3 → S3 Versioning → Glacier (Long-term)
                  ↓
              S3 Replication (Optional)
                  ↓
            us-west-2 (Backup Region)
```

---

**This architecture provides:**
- ✅ 99.99% availability
- ✅ Auto-scaling
- ✅ Global CDN
- ✅ SSL encryption
- ✅ Cost optimization
- ✅ Easy monitoring
- ✅ Automatic backups
