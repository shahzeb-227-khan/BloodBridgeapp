# BloodBridge CEP Implementation Plan

## 1. Purpose of this plan

This plan converts the SE-490 Complex Engineering Activity (CEA) statement into
an executable project for the BloodBridge repository.

The objective is not to rewrite BloodBridge. The objective is to understand the
existing application, complete the missing production/deployment pieces, and
demonstrate a secure, containerized, three-tier cloud deployment with automated
CI/CD.

## 2. Recommended target solution

This plan assumes **AWS** because the required services map clearly to AWS
services and AWS has strong educational documentation:

| CEP layer | Recommended implementation |
|---|---|
| Network | Amazon VPC, two Availability Zones, public/private subnets, route tables, Internet Gateway, NAT Gateway |
| Web tier | Expo web export served by an Nginx Docker container |
| Application tier | BloodBridge FastAPI Docker container |
| Database tier | Amazon RDS PostgreSQL with PostGIS support, private subnets only |
| Compute | Amazon ECS on Fargate, or ECS on EC2 if the course specifically requires an Auto Scaling Group |
| Load balancing | Application Load Balancer (ALB) |
| Registry | Amazon Elastic Container Registry (ECR) |
| CI/CD | GitHub Actions with AWS OIDC authentication |
| Secrets | AWS Secrets Manager or Systems Manager Parameter Store |
| Logging/monitoring | Amazon CloudWatch Logs, metrics, alarms, and dashboards |
| Infrastructure as Code | Terraform |
| Cloud-native enhancement | Terraform + CloudWatch + S3 backups/static assets |

### Important platform decision

The current frontend is an Expo/React Native mobile application. The CEP
requires browser access, so the project must produce an Expo web build:

1. Configure and verify `npx expo export --platform web`.
2. Copy the generated static files into an Nginx image.
3. Serve the frontend publicly through the ALB.
4. Route API traffic from the web tier to the private FastAPI service.

If Expo web cannot support one of the mobile-only features, document that
limitation honestly and ensure the browser demo covers the core flows:
registration/login, creating a blood request, viewing/matching requests, and
profile/history functionality.

## 3. Current repository assessment

The repository already contains a substantial application:

### Existing frontend

- Expo SDK 57 and React Native with TypeScript
- Expo Router navigation
- Donor and requestor roles
- Authentication and persisted sessions
- Blood request screens
- Matching/commitment flows
- Profiles, history, notifications, and chat screens
- API client with bearer-token handling

Relevant location: `myApp/`.

### Existing backend

- FastAPI application in `backend/main.py`
- Modular routers/controllers for donors, requestors, hospitals,
  organizations, blood requests, matches, chat, notifications, and admin
- JWT authentication
- Rate limiting and CORS
- WebSocket chat endpoint
- Scheduled request-expiry and radius-expansion jobs

Relevant location: `backend/`.

### Existing database

- PostgreSQL/PostGIS
- SQLAlchemy models
- Alembic migrations
- Geospatial indexes and matching queries
- Constraints and indexes for core entities

### Existing local deployment

`backend/docker-compose.yml` currently starts PostGIS and Adminer. It does not
yet containerize the API or frontend, so it is a development database setup,
not the final three-tier deployment.

### Current gaps to close

- No application Dockerfile
- No frontend web Dockerfile
- No production root-level Compose arrangement
- No Terraform/cloud infrastructure
- No ECR registry workflow
- No CI/CD workflow
- No managed production database
- No production secrets integration
- No documented ALB/scaling design
- No complete automated test gate
- No CEP architecture diagram, evidence pack, or final report

## 4. Target architecture

```text
Developer
   |
   | git push / pull request
   v
GitHub Repository
   |
   v
GitHub Actions
   |-- lint/type-check/test
   |-- build frontend image
   |-- build backend image
   |-- push images to ECR
   |-- run migrations as a controlled deployment step
   |-- update ECS services
   v
AWS VPC
├── Public subnets (AZ-a, AZ-b)
│   ├── Application Load Balancer
│   └── NAT Gateway
│
├── Private application subnets (AZ-a, AZ-b)
│   └── ECS/Fargate tasks
│       ├── Nginx web container
│       └── FastAPI application container
│
└── Private database subnets (AZ-a, AZ-b)
    └── RDS PostgreSQL/PostGIS

ECS/FastAPI --> RDS PostgreSQL/PostGIS
ECS/Nginx --> ECS/FastAPI
ECS tasks --> CloudWatch Logs
ECS tasks --> Secrets Manager/Parameter Store
RDS --> automated backups
S3 --> optional uploads/static assets/backups
```

### Recommended traffic rules

| Source | Destination | Port | Reason |
|---|---|---:|---|
| Internet | ALB | 80/443 | Public browser access |
| ALB security group | Web/ECS security group | 80 | Frontend traffic |
| Web/ECS security group | API/ECS security group | 8000 | Nginx reverse proxy to FastAPI |
| API/ECS security group | RDS security group | 5432 | Database access |
| ECS tasks | NAT Gateway | 443 | Image pulls, email/cloud services, updates if required |
| Internet | RDS | Denied | Database must never be public |

Use separate security groups even if web and API containers are initially
co-located. If the final deployment uses separate ECS services, preserve this
separation in the task/service design.

## 5. Execution phases

### Phase 0 — Project onboarding and baseline

**Goal:** Understand the friend's application before changing it.

Tasks:

- Clone/open the repository and identify the `myApp` and `backend` boundaries.
- Read the root README, `backend/SETUP.md`, backend settings, database models,
  Alembic migrations, routers, and frontend API client.
- Draw a simple request flow for:
  - donor signup/login
  - requestor signup/login
  - blood-request creation
  - nearby donor matching
  - commitment completion
  - chat
- Create a local environment from `.env.example`.
- Start PostGIS with the existing Compose file.
- Run Alembic migrations.
- Start FastAPI and verify `/docs` and `/`.
- Start Expo and verify the frontend can call the local API.
- Record known defects separately; do not silently modify unrelated behavior.

Exit criteria:

- A new team member can explain the frontend, API, database, and authentication
  flow.
- Local backend health and database migration succeed.
- At least one real frontend-to-backend user journey works.

### Phase 1 — Define the production contract

**Goal:** Decide what will be deployed and remove ambiguity.

Tasks:

- Confirm AWS account, region, budget limit, and available course credits.
- Select a unique project/environment naming convention, for example:
  `bloodbridge-dev`, `bloodbridge-staging`, and `bloodbridge-prod`.
- Select the deployment model:
  - Preferred: ECS Fargate for simpler managed containers.
  - Alternative: ECS on EC2 if an explicit Auto Scaling Group is expected.
- Decide whether web and API use separate ECS services or one task definition.
- Define required environment variables and classify each as:
  - public build-time configuration
  - runtime configuration
  - secret
- Define a health endpoint for the ALB.
- Define migration ownership: migrations must run once per deployment, not once
  per application worker.
- Define rollback behavior using the previous immutable image tag.

Deliverable:

- A one-page deployment decision record committed in the repository or included
  in the technical report.

### Phase 2 — Make the application deployment-ready

**Goal:** Preserve existing behavior while making the application safe to run
in containers and behind a load balancer.

Backend tasks:

- Add a production backend Dockerfile.
- Run as a non-root user where practical.
- Use a production server command such as Gunicorn/Uvicorn workers, after
  confirming WebSocket compatibility.
- Add or verify `/health` and a database-readiness check.
- Read all runtime configuration from environment variables.
- Ensure `TRUST_PROXY` is enabled only behind the controlled ALB/proxy.
- Configure production CORS with the real frontend origin.
- Set `ENABLE_SCHEDULER=false` for horizontally scaled API tasks unless the
  scheduler is moved to a single dedicated job/worker.
- Ensure WebSocket routing and idle timeouts are compatible with the ALB.
- Do not put database passwords, JWT secrets, admin credentials, or API keys
  in source control.

Frontend tasks:

- Verify Expo web support for the required screens.
- Replace development-only API defaults with a build-time public API URL.
- Ensure the production API URL is HTTPS.
- Add a frontend Dockerfile with a build stage and a small Nginx runtime stage.
- Add Nginx configuration for:
  - SPA/Expo route fallback
  - static assets
  - API reverse proxy if this routing model is selected
  - WebSocket upgrade headers if Nginx proxies WebSockets
- Keep mobile builds working; web deployment must not break native workflows.

Database tasks:

- Confirm all migrations run cleanly against a fresh PostgreSQL/PostGIS
  database.
- Review migration ordering and production-safe behavior.
- Add a controlled migration command to deployment documentation.
- Decide whether uploaded images remain in Cloudinary or move to S3.

Testing tasks:

- Add backend unit/API tests for authentication, authorization, migrations,
  request creation, matching, and health checks.
- Add at least one integration test against PostgreSQL/PostGIS.
- Run frontend lint and TypeScript checks.
- Add a smoke test that calls the deployed frontend/API health endpoint.

Exit criteria:

- Backend image starts with no source checkout dependency.
- Frontend web image builds and opens in a browser.
- No production secret is present in Git history or image build arguments.
- All mandatory checks fail the pipeline when broken.

### Phase 3 — Local three-tier containerization

**Goal:** Prove the complete container arrangement before using AWS.

Create:

- `backend/Dockerfile`
- `myApp/Dockerfile`
- `myApp/nginx.conf` or equivalent Nginx configuration
- root `docker-compose.yml`
- `.dockerignore` files
- optional `compose.production.yml` for production-like local behavior

Local services:

| Service | Purpose |
|---|---|
| `web` | Nginx serving Expo web files |
| `api` | FastAPI application |
| `db` | PostgreSQL/PostGIS |
| `adminer` | Local-only database inspection; never production |

Required checks:

- `docker compose build`
- `docker compose up`
- Browser loads the web tier
- Web tier reaches API tier
- API tier reaches database tier
- Migrations run successfully
- Login and one core blood-request workflow work
- Database is not published publicly except for intentional local development

### Phase 4 — Terraform AWS infrastructure

**Goal:** Provision repeatable infrastructure instead of clicking everything
manually.

Create a Terraform layout similar to:

```text
infra/
├── versions.tf
├── providers.tf
├── variables.tf
├── outputs.tf
├── networking.tf
├── security_groups.tf
├── ecr.tf
├── ecs.tf
├── alb.tf
├── rds.tf
├── iam.tf
├── cloudwatch.tf
├── secrets.tf
├── s3.tf
└── environments/
    ├── dev.tfvars
    └── prod.tfvars.example
```

Provision and document:

- VPC CIDR, for example `10.0.0.0/16`
- Two public subnets in separate AZs
- Two private application subnets in separate AZs
- Two private database subnets in separate AZs
- Internet Gateway
- Public route table
- Private route tables
- NAT Gateway(s), with a cost-aware single-NAT option documented
- ALB and target groups
- ECS cluster, task definitions, services, and desired counts
- ECS task execution role and task role
- ECR repositories
- RDS subnet group and parameter/security configuration
- CloudWatch log groups
- Secrets Manager/Parameter Store entries
- S3 bucket if selected
- IAM policies following least privilege

Terraform requirements:

- Use variables, outputs, tags, and remote state guidance.
- Do not commit `terraform.tfstate`, credentials, or secret values.
- Run `terraform fmt`, `terraform validate`, and `terraform plan`.
- Save the approved plan output/evidence without exposing secrets.
- Add a destroy procedure and cost warning.

### Phase 5 — Container registry

**Goal:** Store immutable deployable artifacts.

Tasks:

- Create separate ECR repositories for `bloodbridge-web` and
  `bloodbridge-api`, or document a justified combined strategy.
- Enable image scanning.
- Tag images with the commit SHA.
- Optionally add a human-readable branch/environment tag, but deploy by SHA.
- Configure lifecycle policies to remove old images.
- Confirm the registry listing is visible for the evidence screenshots.

Acceptance criteria:

- A clean machine can pull the image using the documented authentication flow.
- The image starts with only runtime environment configuration.
- The image is traceable to a Git commit.

### Phase 6 — GitHub Actions CI/CD

**Goal:** Every code change is automatically validated and deployable.

Create:

```text
.github/workflows/ci.yml
.github/workflows/deploy.yml
```

Pull request/CI workflow:

1. Check out source.
2. Set up Python and Node.
3. Install dependencies.
4. Run backend formatting/lint/type checks if configured.
5. Run backend tests.
6. Run frontend lint.
7. Run frontend TypeScript check.
8. Build the web bundle.
9. Build both Docker images.
10. Optionally run the local Compose smoke test.

Deployment workflow:

1. Trigger on merge to the chosen deployment branch.
2. Authenticate to AWS using GitHub OIDC, not long-lived access keys.
3. Log in to ECR.
4. Build images with commit-SHA tags.
5. Push images to ECR.
6. Render/update ECS task definitions.
7. Run the migration task exactly once.
8. Update ECS services.
9. Wait for services to become stable.
10. Call the ALB health endpoint.
11. Run a smoke test against the deployed URL.
12. Publish the deployment result.

Security requirements:

- Use a GitHub environment for production approval.
- Restrict OIDC trust to the correct repository and branch/environment.
- Store only non-secret identifiers as GitHub variables.
- Store secrets in AWS Secrets Manager/Parameter Store.
- Never print secrets in logs.
- Use concurrency control to prevent overlapping production deployments.
- Document rollback to the previous image SHA.

### Phase 7 — Load balancing, scaling, and reliability

**Goal:** Satisfy the scalability requirements rather than merely running one
container.

Tasks:

- Configure ALB listeners and target groups.
- Add health checks against a real application endpoint.
- Configure HTTPS with ACM if a domain is available.
- Set ECS desired count to at least two for the production demonstration when
  budget permits.
- Spread tasks across Availability Zones.
- Configure CPU/memory-based target tracking autoscaling.
- Set minimum, desired, and maximum task counts.
- Explain the difference between:
  - ALB distributing traffic
  - ECS service maintaining desired tasks
  - autoscaling changing task count
- Ensure API containers are stateless:
  - sessions/tokens are not stored only in local files
  - uploaded files use Cloudinary/S3
  - chat/database state is externalized
- Choose RDS Multi-AZ if credits/budget permit; otherwise document it as a
  limitation and improvement.
- Configure RDS backups, retention, encryption, and deletion protection
  appropriately for the chosen environment.

### Phase 8 — Security hardening

**Goal:** Demonstrate security controls in both implementation and report.

Tasks:

- Use private subnets for ECS application tasks and RDS.
- Expose only ALB ports publicly.
- Restrict security-group sources by security group, not broad CIDRs.
- Restrict RDS to the API security group on port 5432.
- Encrypt RDS, ECR, logs, S3, and secrets where supported.
- Use HTTPS for browser traffic.
- Use short-lived/rotated credentials where possible.
- Use AWS IAM roles rather than access keys in containers.
- Use GitHub OIDC for CI/CD.
- Keep JWT secret, database URL, mail credentials, admin credentials, and
  Cloudinary/S3 credentials outside Git.
- Scan dependencies and container images.
- Validate authentication and authorization for each role.
- Confirm sensitive patient/contact data is not unnecessarily returned.
- Review CORS and trusted proxy settings.
- Avoid public Adminer or any database administration endpoint.
- Add a security section to the report with evidence references.

### Phase 9 — Cloud-native enhancement

Implement at least one enhancement; this plan recommends implementing three
because they reinforce different CEP requirements:

1. **Infrastructure as Code:** all AWS resources are provisioned by Terraform.
2. **Centralized logging/monitoring:** ECS logs go to CloudWatch with alarms for
   unhealthy targets, task restarts, CPU, memory, and 5xx responses.
3. **Object storage:** use S3 for static assets, uploaded files, or deployment
   backups if this is compatible with the application.

Optional enhancement:

- Kubernetes/EKS should not be added merely for complexity. Use it only if the
  course specifically expects Kubernetes or the team can operate and explain
  it confidently.

### Phase 10 — Validation and evidence collection

**Goal:** Produce proof, not only configuration.

Run and record:

- Repository commit associated with the deployment
- Backend unit and integration test results
- Frontend lint/type-check results
- Docker build output
- ECR image tags
- Terraform validation and plan
- Successful migration task
- Successful ECS deployment
- ALB health check
- Browser smoke test
- Scaling test or documented autoscaling configuration
- Database connectivity through the API
- Security-group verification
- Logs and monitoring alarms
- Rollback procedure or a controlled rollback test if safe

Do not capture credentials, private keys, database passwords, JWT secrets, or
personal user data in screenshots.

## 6. Mandatory screenshot checklist

Create a numbered evidence folder, for example `docs/evidence/`, outside the
source code if screenshots should not be committed.

Required screenshots:

1. VPC overview showing CIDR.
2. Public subnets in both Availability Zones.
3. Private application subnets.
4. Private database subnets.
5. Internet Gateway and public route table.
6. Private route table and NAT Gateway.
7. ECS cluster and running services/tasks.
8. Compute/task configuration.
9. Security groups and inbound/outbound rules.
10. ALB listeners, DNS name, target groups, and healthy targets.
11. RDS engine, subnet group, security, backups, and non-public status.
12. ECR repositories and commit-SHA image tags.
13. GitHub Actions successful CI run.
14. GitHub Actions successful deployment run.
15. Terraform plan/apply evidence.
16. CloudWatch logs and at least one useful metric/alarm.
17. Browser showing the deployed application.
18. A demonstrated core workflow in the deployed application.
19. Optional scaling evidence showing task count changes or configured policy.

For every screenshot, record:

- screenshot number
- date/time
- AWS region
- resource name
- what requirement it proves
- any limitation or redacted information

## 7. Technical report plan: 4–6 pages

Keep the final report within the required length. Use diagrams and compact
tables rather than filling pages with screenshots.

### Suggested structure

#### 1. Introduction and objective

- Explain BloodBridge and its users.
- State the CEP objective.
- Identify the chosen AWS region and deployment model.

#### 2. Existing application and architecture

- Describe the Expo frontend.
- Describe the FastAPI application.
- Describe PostgreSQL/PostGIS and Alembic.
- Explain why the repository is suitable for a three-tier deployment.

#### 3. Cloud architecture and service choices

- Include the architecture diagram.
- Explain VPC, subnets, route tables, NAT, ALB, ECS, and RDS.
- Explain traffic flow and security boundaries.

#### 4. Containerization and CI/CD

- Explain the web and API Dockerfiles.
- Explain ECR image tagging.
- Explain GitHub Actions stages.
- Explain migrations, deployment verification, and rollback.

#### 5. Security

- Explain network segmentation.
- Explain security groups and least privilege.
- Explain secrets management and OIDC.
- Explain encryption, HTTPS, image scanning, and data protection.

#### 6. Testing and deployment results

- Summarize automated checks.
- Show successful build/push/deploy evidence.
- Show browser and API smoke-test results.
- Link evidence numbers to screenshots.

#### 7. NFR justification

Use a table:

| NFR | Implementation decision | Evidence | Limitation/improvement |
|---|---|---|---|
| Scalability | ALB + stateless ECS tasks + autoscaling | ECS/ALB screenshots | Capacity limits based on course budget |
| Availability | Multi-AZ subnets, multiple tasks, managed RDS | VPC/ECS/RDS evidence | Multi-AZ RDS may be omitted in low-cost environment |
| Elasticity | CPU/memory target tracking | ECS scaling policy | Load test is limited |
| Security | Private tiers, SGs, secrets, OIDC, HTTPS | SG/IAM/secret evidence | Formal penetration testing not performed |
| Maintainability | Docker + Terraform + CI/CD | GitHub Actions/Terraform | Manual approval may remain for production |
| Performance | ALB, health checks, suitable task sizing, DB indexes | Metrics/smoke test | No large production load test |
| Cost-efficiency | Fargate sizing, lifecycle policies, budget alarms, NAT strategy | Cost estimate | NAT/ALB/RDS remain baseline costs |
| Portability | Docker, Compose, Terraform patterns, environment config | Source files | AWS managed services require migration work |

#### 8. Cost and conclusion

- Include a monthly estimate using the AWS Pricing Calculator.
- State assumptions: region, task count, hours, storage, traffic.
- Propose at least two optimizations:
  - right-size Fargate tasks
  - scale to zero or use lower desired counts in development
  - use one NAT Gateway for a low-cost educational environment, with the
    availability trade-off documented
  - delete non-production environments when not in use
  - apply ECR lifecycle policies
  - set RDS backup/storage limits
- State honestly what was not fully implemented.

## 8. Source-file checklist for submission

The final repository or submission package should contain, as applicable:

```text
backend/Dockerfile
myApp/Dockerfile
docker-compose.yml
myApp/nginx.conf
.dockerignore
.github/workflows/ci.yml
.github/workflows/deploy.yml
infra/*.tf
infra/environments/*.tfvars.example
README.md
backend/SETUP.md
CEP_IMPLEMENTATION_PLAN.md
architecture-diagram.png or architecture-diagram.drawio
```

Also provide:

- repository URL
- deployment URL
- API health URL
- ECR repository names
- AWS region
- instructions for reproducing the deployment
- instructions for destroying development infrastructure

## 9. Working agreement for understanding the friend's project

Before modifying a feature, use this sequence:

1. Find the frontend screen or route.
2. Find the frontend API helper it calls.
3. Find the matching backend router.
4. Find the controller/service logic.
5. Find the DTO and database model.
6. Find the Alembic migration that created or changed the data.
7. Run the flow locally.
8. Only then change code.

Useful questions to answer while reading:

- Which user role owns this record?
- Which endpoint creates it?
- Which endpoint reads or changes it?
- What authorization rule protects it?
- What database tables and foreign keys are involved?
- Does it depend on location, email, Cloudinary, push notifications, or WebSockets?
- Will it work when there are multiple API containers?

Do not remove existing business logic simply because it is unfamiliar. First
document it and verify it through the API and frontend.

## 10. Definition of done

The CEP implementation is complete only when all of the following are true:

- [ ] A browser can reach the public web tier.
- [ ] The web tier is a Docker image built from a documented Dockerfile.
- [ ] The application tier is a Docker image built from a documented Dockerfile.
- [ ] The application tier runs in private networking.
- [ ] The database is managed or securely self-managed and not public.
- [ ] VPC, public/private subnets, routing, and Internet Gateway exist.
- [ ] NAT exists when private resources need outbound access.
- [ ] Images are pushed to a registry.
- [ ] CI builds, tests, pushes, and deploys on code change.
- [ ] Secrets are not hardcoded and CI uses secure authentication.
- [ ] ALB and target groups are configured.
- [ ] Horizontal scaling or an equivalent is configured and explained.
- [ ] At least one cloud-native enhancement is implemented.
- [ ] All eight NFRs are explicitly justified with limitations.
- [ ] Automated deployment has succeeded at least once.
- [ ] Required screenshots are collected without leaking secrets.
- [ ] Architecture diagram is complete and readable.
- [ ] Technical report is 4–6 pages and includes the required sections.
- [ ] Source repository link and deployment instructions are included.
- [ ] A teammate who did not write the original app can explain the design.

## 11. Recommended order for the next work session

Do not start with AWS clicking. Start with a reproducible local baseline:

1. Read `README.md` and `backend/SETUP.md`.
2. Start the local PostGIS database.
3. Run migrations and start FastAPI.
4. Run the Expo app and complete one donor/requestor workflow.
5. Write down the exact API calls and database tables involved.
6. Verify Expo web export.
7. Add backend and frontend Dockerfiles.
8. Build the complete local three-tier Compose stack.
9. Add tests and CI checks.
10. Only after local success, provision AWS using Terraform.

This order reduces the risk of deploying an application that the team does not
yet understand.
