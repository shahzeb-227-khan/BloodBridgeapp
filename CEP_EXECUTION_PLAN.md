# BloodBridge CEP: 6-Hour Execution Plan (Copilot + You)

Read this whole file once (15 min) before touching anything.

---

## 0. How to use this plan

### The rule that gives you ownership
Copilot writes code. **You** must understand it. For every Copilot task:

1. **Read the diff** (VS Code > Source Control, or `git diff`). Do not accept blindly.
2. **Ask Copilot to explain it** with the follow-up prompt in section 6, "Understanding prompt". Save the explanation into `cep-notes/`. This becomes your report material.
3. **Run the verify command** listed under the task. If it fails, paste the error back to Copilot.
4. **Answer the ownership questions** listed under the task, out loud or in a notes file, without looking. If you can't, ask Copilot to explain that part again.

Your examiner or viva will ask about this stuff. Being able to explain each file is the real goal.

### Who does what
- **YOU** do: installing tools, AWS account and credentials, running `terraform` and `aws`/`docker` commands, GitHub secrets, screenshots, the architecture diagram, and writing the report in your own words.
- **COPILOT** does: Dockerfiles, compose files, nginx config, the one backend code change, Terraform files, GitHub workflow files, and tests.

### Copilot quota (you have a limit)
- Use **one prompt per task**. Each prompt below is written to be complete. Don't chat back and forth more than needed.
- Use **Agent mode** in Copilot Chat so it can edit several files in one request.
- Critical small files are also written out in full in **Appendix A**. If your quota runs out, paste those in yourself.

### What to cut if time runs out (in this order)
1. Load test. Show the autoscaling config and explain it instead.
2. HTTPS / ACM. You probably have no domain. Document HTTP-only as a limitation.
3. Second and third cloud-native enhancement. One is enough: Terraform (IaC) plus CloudWatch.
4. ESLint cleanup. If `npm run lint` fails on existing code, run only the TypeScript check.
5. Multi-AZ RDS. Document it as a limitation.

**Never cut:** a working public URL, the pipeline run (green), Terraform, the three tiers, private DB, and the report.

---

## 1. Glossary (what everything is)

| Term | Plain meaning | Where it appears |
|---|---|---|
| **Docker image** | A packaged, runnable copy of your app and its dependencies. | Backend and web tiers |
| **Dockerfile** | The recipe that builds an image. | `backend/Dockerfile`, `myApp/Dockerfile` |
| **Container** | A running image. | Local Docker and ECS |
| **docker-compose** | Runs several containers together on your laptop. | Root `docker-compose.yml` |
| **PostgreSQL + PostGIS** | The database, with map/distance extensions. BloodBridge's matching uses distances. | DB tier |
| **Alembic** | Tool that creates and updates database tables (migrations). | Run once per deploy |
| **Expo web export** | Turns the React Native app into static HTML/JS/CSS for browsers. | Web tier |
| **Nginx** | Web server. Serves the static web app. Locally it also forwards `/api` to the backend. | Web tier |
| **VPC** | Your private network inside AWS. | Network |
| **Subnet** | A slice of the VPC. *Public* = reachable from internet. *Private* = not. | Network |
| **Internet Gateway** | Lets public subnets reach the internet. | Network |
| **NAT Gateway** | Lets private resources go *out* to the internet (for example, pulling images) without being reachable *from* it. | Network |
| **Route table** | Rules that say where network traffic goes. | Network |
| **Security group** | Firewall per resource. We chain them: internet -> ALB -> web -> API -> database. | Security |
| **ALB** (Application Load Balancer) | Receives browser traffic and sends it to healthy containers. Routes `/api/*` to the API. | Load balancing |
| **Target group** | The list of containers the ALB sends traffic to. | Load balancing |
| **ECR** | AWS's private Docker image storage. | Registry |
| **ECS Fargate** | AWS runs your containers without you managing servers. | Compute |
| **ECS Service** | Keeps N copies of a task running and replaces failed ones. | Compute |
| **Task definition** | The JSON/Terraform description of a container (image, CPU, memory, env, secrets). | Compute |
| **Auto Scaling (target tracking)** | Adds/removes tasks based on CPU. This is "elasticity". | Scaling |
| **RDS** | Managed PostgreSQL. AWS handles backups and patching. | Database |
| **Secrets Manager** | Encrypted storage for passwords and keys. Containers read them at start. | Secrets |
| **CloudWatch** | Logs, metrics, and alarms. | Monitoring |
| **Terraform** | Describes AWS infrastructure in code (`.tf` files) so it can be recreated. | Infrastructure as code |
| **GitHub Actions** | Runs a workflow (script) on GitHub every time you push. | CI/CD |
| **OIDC** | Lets GitHub Actions log into AWS without storing AWS keys. | CI/CD security |

### The picture you are building

```
Browser
  |
  v
ALB (public subnets)  ---- /api/*  ------> API tasks (FastAPI, private app subnets)
  |                                            |
  +-- everything else --> Web tasks (Nginx)     +--> RDS PostgreSQL (private DB subnets)
  (static Expo web app)                         +--> Secrets Manager, CloudWatch Logs

GitHub push -> Actions -> build images -> ECR -> update ECS services -> run migration task
```

**Key design choice (explain this in your report):** The browser calls the API at `/api/...` on the same domain. The ALB sends `/api/*` to the API and everything else to the web container. The API has a small middleware that strips the `/api` prefix. This avoids CORS problems and needs no separate domain.

---

## 2. Setup: install and create everything (first 40 minutes, you do this)

### 2.1 Install these on your Windows machine

Open PowerShell as normal user.

1. **Docker Desktop** (https://www.docker.com/products/docker-desktop). Use the WSL 2 backend. Restart when asked. Open it and wait for "Engine running".
2. **Git** (if missing): https://git-scm.com
3. **Node.js 22 LTS** (https://nodejs.org). Check: `node -v` (should be v22.x).
4. **AWS CLI v2**: download the Windows MSI from https://aws.amazon.com/cli/ . Check: `aws --version`.
5. **Terraform**: https://developer.hashicorp.com/terraform/install (Windows zip, or `winget install Hashicorp.Terraform`). Check: `terraform -version`.
6. **VS Code** with the **GitHub Copilot** and **GitHub Copilot Chat** extensions. Sign in.

Verify Docker:
```powershell
docker version
docker compose version
```

### 2.2 AWS access (check this within the first 10 minutes)

You need an AWS account. Two cases:

**Case A: AWS Academy / Learner Lab (most university courses)**
1. Open the lab from your course portal, click **Start Lab**, wait for the green dot.
2. Click **AWS Details** > **AWS CLI** and copy the three values (access key, secret, session token).
3. Lab credentials expire when the lab stops, so set them again each session.
4. Lab restrictions: you may not be able to create IAM roles or OIDC providers. If so, use access keys in GitHub Secrets (see 8.2) and document it as a limitation. The lab region is usually `us-east-1`. Use whatever region your lab allows.

**Case B: your own AWS account.** Create an account, enable billing, and create an IAM user with admin access for this project. Create an access key for the CLI. Set a **budget alarm** at $20 in the Billing console.

Configure the CLI (PowerShell):
```powershell
aws configure
# Access key ID, secret, region (for example ap-south-1 or us-east-1), output json
aws sts get-caller-identity
```
If `get-caller-identity` prints your account, you're ready.

For Learner Lab, also run:
```powershell
aws configure set aws_session_token "PASTE_TOKEN_HERE"
```

### 2.3 GitHub repository

```powershell
cd "C:\Users\shahz\OneDrive\Desktop\BloodBridge"
git status
git remote -v
```
- If `git remote -v` shows a GitHub URL, you're set.
- If not: create an empty repo on github.com named `bloodbridge`, then:
```powershell
git remote add origin https://github.com/YOUR_USERNAME/bloodbridge.git
git branch -M main
git add .
git commit -m "Baseline before CEP deployment"
git push -u origin main
```
(Check `.gitignore` is excluding `.env` first. It is, but confirm with `git status` that no `.env` appears.)

Create a working branch:
```powershell
git checkout -b cep-deploy
```

### 2.4 Make sure the app runs locally (20 minutes, see section 3)

Do this before any Copilot task so you know what "working" looks like.

### 2.5 Create the notes folder

```powershell
mkdir cep-notes
```
Copilot will save its explanations here. You'll use them for the report.

---

## 3. Get the app running locally (you do this, 20 min)

### 3.1 Database (PostGIS) with the existing compose file

The existing `backend/docker-compose.yml` starts PostGIS on host port **5433** (inside: 5432) and Adminer on 8082.

```powershell
cd backend
docker compose up -d db
docker compose ps
```
You should see `bloodbridge-db` running.

Check `backend/.env` has the matching database URL. It should look like:
```
DATABASE_URL=postgresql://bloodbridge_user:bloodbridge_pass@localhost:5433/bloodbridge
```
If the port in your `.env` is `5432`, change it to `5433` (or change the compose port). Keep one value consistent.

**Create the database user if it's missing:** the compose file creates it automatically on first start. If you already had an older volume, run:
```powershell
docker compose exec db psql -U bloodbridge_user -d bloodbridge -c "select version();"
```
If that works, the DB is ready.

### 3.2 Python venv and migrations

You already have `backend/.venv`. Activate it and run migrations:
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
```
If `pip` errors on a package, skip it and let the Docker build handle it later.

Start the API:
```powershell
uvicorn main:app --reload --port 8000
```
Open http://localhost:8000/docs in a browser. You should see the Swagger page.

### 3.3 Run the frontend

Open a second PowerShell:
```powershell
cd "C:\Users\shahz\OneDrive\Desktop\BloodBridge\myApp"
npm ci
npx expo start --web
```
Browser opens. Set `myApp\.env` to `EXPO_PUBLIC_API_URL=http://localhost:8000` (it currently uses a LAN IP, which is fine for phone testing but not for a web demo on your laptop).

### 3.4 Complete one journey (this is your "baseline" proof)

Sign up as a requestor, verify (or set `REQUIRE_EMAIL_VERIFICATION=false` in `backend/.env` for local work only), log in, create a blood request. Write down the endpoints you hit: they go in your notes for the report.

### 3.5 Know the codebase (10 minutes of reading, you do this)

Open these in VS Code and skim them. You'll be asked about them.

- `backend/main.py`: app creation, routers, CORS, lifespan (starts scheduler).
- `backend/src/utils/settings.py`: all env variables.
- `backend/src/blood_requests/router.py` line ~144: the expire and auto-widen sweep endpoints `/blood-requests/admin/expire-overdue` and `/blood-requests/admin/auto-widen`.
- `backend/alembic/versions/`: migration chain. Current head is `4fc43f118cde`.
- `myApp/src/lib/apiClient.ts`: how the frontend picks its API URL.
- `myApp/src/lib/tokenStorage.ts`: already has a web fallback (localStorage), so no change needed there.

---

## 4. The target deployment (decide once, then don't change)

| Layer | Choice | Why (for your report) |
|---|---|---|
| Cloud | AWS | Matches the CEA's examples. |
| Region | Whatever your lab/account allows (`ap-south-1` Mumbai if you have a choice, close to Pakistan) | Lower latency. |
| Network | VPC `10.0.0.0/16`, 2 AZs, 3 subnet tiers | Segmentation (requirement 1 and 8). |
| Web tier | Nginx container (ECS Fargate), port 8080 | Requirement 2. |
| API tier | FastAPI container (ECS Fargate), port 8000, private subnets, 2 tasks | Requirement 3. |
| DB tier | RDS PostgreSQL 16 + PostGIS, private DB subnets, not public | Requirement 4. |
| Registry | ECR, two repos, scan on push | Requirement 5. |
| CI/CD | GitHub Actions: CI on PR, deploy on push to `main` | Requirement 6. |
| Load balancing | One ALB, `/api/*` to API target group, default to web target group | Requirement 7. |
| Scaling | ECS Service Auto Scaling on the API (min 2, max 4, CPU 60%) | Requirement 7 and elasticity NFR. |
| Secrets | Secrets Manager; injected into tasks; never in Git or images | Requirement 8. |
| Enhancement | Terraform (IaC) + CloudWatch logs and alarms | Requirement 9 (you need at least one). |
| Cost | Single NAT gateway, Fargate small sizes, `terraform destroy` after evidence | Cost-efficiency NFR. |

**Limitations to state honestly in the report:** single NAT (not HA), HTTP only if no domain, per-task rate limiting, per-task chat WebSocket broadcast, scheduler run by one scheduled job, Cloudinary for images (not S3).

---

## 5. Timeline (you start at about 14:56; your deadline is about 20:56)

| Time | Block | Owner |
|---|---|---|
| 0:00 to 0:40 | Section 2 setup, AWS access check, Git remote | You |
| 0:40 to 1:20 | Local run (section 3). Tasks C1 to C4 | You + Copilot |
| 1:20 to 1:50 | Tasks C5 to C7 (web Dockerfile, nginx, compose, tests). Verify localhost:8080 works | Copilot + You |
| 1:50 to 2:20 | Terraform tasks T1 to T3 generated. Run `terraform init` and `plan` | Copilot + You |
| 2:20 to 2:50 | `terraform apply` (RDS and NAT take 15 to 20 min, so **write the CI prompts during this wait**) | You |
| 2:50 to 3:20 | Tasks C12 and C13 generated (CI and deploy workflows) | Copilot |
| 3:20 to 3:50 | Push images to ECR, run migration, first deploy, open ALB URL in browser | You |
| 3:50 to 4:30 | Set GitHub secrets. Get a green CI run and a green deploy run. Broken-commit demo | You |
| 4:30 to 5:00 | Autoscaling and CloudWatch alarm check. Collect screenshots | You |
| 5:00 to 5:50 | Report and architecture diagram (write sections yourself, see section 10) | You |
| 5:50 to 6:00 | Final checklist (section 11). Keep AWS running until submission, then `terraform destroy` | You |

If you are more than 45 minutes behind at 3:30, activate the cuts in section 0.

---

## 6. Copilot task catalogue (copy these prompts)

**How to run a prompt:** open the repo in VS Code, open Copilot Chat, switch to **Agent** mode, attach the files named in the prompt if asked (or just reference the paths), paste the prompt, and review the changes.

**Understanding prompt (use after EVERY task):**
```
Explain every file you created or changed, as if I must defend it in a viva.
For each file: its purpose, the important lines, why each design choice was made,
and one thing that could go wrong. Save this explanation as a markdown file in
cep-notes/ named after the task (for example cep-notes/C1-backend-docker.md).
Do not change any code while explaining.
```

---

### PHASE A: Local containers (Copilot C1 to C7)

#### C1: Backend Dockerfile, .dockerignore, and health check
**Owner:** Copilot writes, you verify.
**Prompt:**
```
Context: This is a FastAPI app in the backend/ folder (main.py, src/, alembic/,
requirements.txt, alembic.ini). It uses PostgreSQL with PostGIS through
SQLAlchemy and reads all config from environment variables via
src/utils/settings.py (pydantic-settings). Python 3.12 is the target.

Tasks:
1. Create backend/Dockerfile:
   - FROM python:3.12-slim
   - set PYTHONDONTWRITEBYTECODE=1, PYTHONUNBUFFERED=1, PIP_NO_CACHE_DIR=1
   - WORKDIR /app; copy requirements.txt first and pip install it (layer caching)
   - then copy the rest of the source
   - create a non-root user "appuser" and switch to it
   - EXPOSE 8000
   - CMD uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
     --proxy-headers --forwarded-allow-ips="*"
2. Create backend/.dockerignore excluding: .venv, __pycache__, *.pyc, .env, .env.*,
   .git, .pytest_cache, tests/ (keep .env.example out too).
3. Add a /health endpoint in main.py that runs "SELECT 1" against the database
   through the existing SQLAlchemy session/engine and returns
   {"status": "ok", "database": "ok"} with HTTP 200, or HTTP 503 with
   {"status": "degraded", "database": "error"} if the query fails. Keep the
   existing "/" route unchanged. Use the existing database dependency/engine
   from src/utils/database.py; do not create a new engine.
4. Do NOT change any other business logic. Do not hardcode any secret.

Verify: explain how I would run "docker build -t bloodbridge-api ./backend"
and "docker run" with env vars.
```
**Verify (you):**
```powershell
cd backend
docker build -t bloodbridge-api .
```
Then (after C2 is done, see below) run the container with the env vars from your `.env` file.

**Ownership questions:**
- Why do we copy `requirements.txt` before the rest of the code?
- Why is the app not running as root?
- What does `--forwarded-allow-ips="*"` do and why is it safe *only behind our ALB*?
- Why does `/health` hit the database? (Answer: the ALB needs to know the app can actually serve requests.)

---

#### C2: Backend: /api prefix middleware and deployment-safe settings
**Owner:** Copilot writes, you verify.
**Prompt:**
```
Context: backend/main.py mounts routers at root paths (/donors, /requestors,
/blood-requests, /chat, /request-matches, /notifications, /admin, /hospitals,
/organizations). In the cloud, the load balancer will route browser requests
under /api/... to the API. The API must accept both "/api/donors/login" and
"/donors/login" so local development keeps working.

Tasks:
1. In backend/main.py, add a pure ASGI middleware class named StripApiPrefix:
   - __init__(self, app)
   - __call__(scope, receive, send): if scope["type"] is "http" or "websocket"
     and the path is "/api" or starts with "/api/", then copy the scope and set
     scope["path"] to the path with the first 4 characters ("/api") removed,
     using "/" if the result is empty. If scope has "raw_path" (bytes), strip
     the first 4 bytes from it too. Then call the wrapped app.
2. Register it with app.add_middleware(StripApiPrefix) AFTER the CORSMiddleware
   line, so it runs first (outermost).
3. Add a short comment above the class explaining why it exists.
4. In backend/src/utils/settings.py, make sure ENABLE_SCHEDULER and TRUST_PROXY
   are read from env (they already are; just confirm, do not change defaults).
5. Do not change any router, controller, or model.

Also, check backend/src/chat/router.py websocket route and confirm the stripping
also works for websockets (scope type "websocket").
```
**Verify (you):**
```powershell
uvicorn main:app --port 8000
```
Then open http://localhost:8000/api/docs (should load Swagger) and http://localhost:8000/docs (should also load).

**Ownership questions:**
- What is an ASGI middleware, and what is `scope`?
- Why do we strip the prefix instead of changing every route?
- Why must the middleware be added after CORS?
- Why does the chat websocket need this too?

---

#### C3: docker-compose for local, with no hardcoded passwords
**Owner:** Copilot writes, you verify.
**Prompt:**
```
Context: backend/docker-compose.yml currently hardcodes POSTGRES_PASSWORD
"bloodbridge_pass" and runs postgis/postgis:15-3.4. The project's SETUP.md says
PostgreSQL 16. Secrets must not be hardcoded.

Tasks:
1. Edit backend/docker-compose.yml:
   - change the image to postgis/postgis:16-3.4
   - replace the hardcoded password with ${POSTGRES_PASSWORD}
   - keep the adminer service but bind it to 127.0.0.1 only
   - keep the existing host port 5433 mapping
   - add a healthcheck for the db service using pg_isready
2. Create backend/.env.example additions as a comment block only if needed, and
   document POSTGRES_PASSWORD in a new file cep-notes/local-env.md (names only,
   no values).
3. Explain that Docker Compose reads a file named .env in the same folder for
   ${VARIABLE} substitution, and that this file is gitignored.

Do not print or commit any real password.
```
**Verify (you):** Create `backend/.env` line (already exists, add): `POSTGRES_PASSWORD=bloodbridge_pass` (local only). Then:
```powershell
cd backend
docker compose down
docker compose up -d db
docker compose ps
```
`db` should be `healthy`.

**Ownership questions:**
- Why is an env var better than a hardcoded password? (Answer: it is not in Git history or in the image.)
- What does `127.0.0.1:` before a port mapping do?
- Why do we keep a healthcheck on the database?

---

#### C4: Frontend API URL from build-time variable, no LAN IP fallback
**Owner:** Copilot writes, you verify.
**Prompt:**
```
Context: myApp/ is an Expo SDK 57 React Native app that also builds for the web.
myApp/src/lib/apiClient.ts sets:
  export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://192.168.100.5:8000";
Expo inlines EXPO_PUBLIC_* variables at build (export) time.

Tasks:
1. In myApp/src/lib/apiClient.ts, remove the hardcoded LAN IP fallback. Keep the
   variable, but if it is undefined, fall back to "http://localhost:8000"
   (never a private IP). Keep the "??" behaviour so an EMPTY string "" is NOT
   replaced: the production web build sets it to "/api" (relative path, same
   origin).
2. Check every place that builds a WebSocket URL (search for "ws://", "wss://",
   "/chat/ws" and "replace(\"http\"") in myApp/src/lib/chat.ts and related files.
   Make the WebSocket URL derive from API_BASE_URL. If API_BASE_URL is relative
   ("/api"), derive the WebSocket origin from window.location on web:
   use wss: when the page is https, ws: otherwise. Keep native behaviour unchanged.
3. Search the whole myApp/src tree for any other hardcoded "192.168." or
   "localhost:8000" string and list them in your answer. Do not change them
   unless they are the API URL.
4. Do not change UI code.

Verify: run `npx tsc --noEmit` in myApp and show the result.
```
**Verify (you):**
```powershell
cd myApp
npx tsc --noEmit
```

**Ownership questions:**
- Why does Expo need the env var at build time and not runtime?
- Why is a relative URL "/api" a good idea for the web build?
- Why must the WebSocket use `wss:` on https?

---

#### C5: Frontend Dockerfile and Nginx config
**Owner:** Copilot writes, you verify.
**Prompt:**
```
Context: myApp/ is an Expo SDK 57 app with expo-router. Web export:
`npx expo export --platform web` writes static files to dist/. Expo takes
EXPO_PUBLIC_API_URL at export time. Backend routes live under /api (the backend
strips /api). Locally, Nginx must also forward /api/ to the backend service named
"api" on port 8000. In the cloud, the ALB does that routing instead, so the
same nginx.conf works in both places.

Tasks:
1. Create myApp/Dockerfile as a multi-stage build:
   - stage "build": FROM node:22-alpine; WORKDIR /app; copy package.json and
     package-lock.json; RUN npm ci (if it fails because the lockfile is out of sync,
     use npm install and tell me); copy the rest; ARG EXPO_PUBLIC_API_URL=/api;
     ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL; RUN npx expo export --platform web
   - stage "runtime": FROM nginx:1.27-alpine; copy myApp/nginx.conf to
     /etc/nginx/conf.d/default.conf; copy /app/dist from the build stage to
     /usr/share/nginx/html; EXPOSE 8080
2. Create myApp/nginx.conf:
   - server listens on 8080
   - root /usr/share/nginx/html; index index.html
   - location /api/ : proxy_pass http://api:8000; proxy_http_version 1.1;
     Upgrade and Connection headers for WebSockets; Host, X-Forwarded-For,
     X-Forwarded-Proto headers; proxy_read_timeout 3600s
   - location / : try_files $uri $uri/ /index.html  (SPA fallback)
   - add gzip for text/css, application/javascript, application/json
3. Create myApp/.dockerignore excluding node_modules, .expo, dist, .env, .env.*,
   .git, ios, android.
4. Explain in cep-notes why nginx serves the SPA fallback and why the /api
   location must come before the / location.

Do not change the app code.
```
**Verify (you):**
```powershell
cd myApp
docker build --build-arg EXPO_PUBLIC_API_URL=/api -t bloodbridge-web .
```
Build takes 3 to 6 minutes the first time.

**Ownership questions:**
- Why is the build multi-stage? (Answer: the final image has no Node, no source, no node_modules.)
- Why is `EXPO_PUBLIC_API_URL` a build argument and not an environment variable at runtime?
- What does `try_files ... /index.html` do for a route like `/request/123`?

---

#### C6: Root docker-compose.yml (three tiers)
**Owner:** Copilot writes, you verify.
**Prompt:**
```
Context: Repo root contains myApp/ (Dockerfile + nginx.conf), backend/ (Dockerfile,
.env, requirements.txt). We need a root docker-compose.yml that runs three tiers
on one private Docker network.

Create /docker-compose.yml at the repo root:
- service "db": image postgis/postgis:16-3.4; env POSTGRES_DB=bloodbridge,
  POSTGRES_USER=bloodbridge_user, POSTGRES_PASSWORD=${POSTGRES_PASSWORD};
  named volume bloodbridge_data; healthcheck pg_isready; NO "ports" section
  (never publish the DB). 
- service "api": build context ./backend; env_file ./backend/.env; environment
  overrides: DATABASE_URL=postgresql://bloodbridge_user:${POSTGRES_PASSWORD}@db:5432/bloodbridge,
  ENABLE_SCHEDULER=false, TRUST_PROXY=true; depends_on db with condition service_healthy;
  NO ports section (only web is reachable from the host).
- service "web": build context ./myApp, args EXPO_PUBLIC_API_URL=/api;
  ports "8080:8080"; depends_on api.
- All services on one network named "bloodbridge".
- Top-level named volume bloodbridge_data.
- Keep the old backend/docker-compose.yml for DB-only dev; do not delete it.

Explain each service in cep-notes/C6-compose.md. Do not commit any .env.
```
**Verify (you):** Create a root `.env` file with one line: `POSTGRES_PASSWORD=bloodbridge_pass` (local only, gitignored). Then:
```powershell
cd "C:\Users\shahz\OneDrive\Desktop\BloodBridge"
docker compose up --build
```
When it's running, open **http://localhost:8080**. Log in and create a request. Then, in another PowerShell:
```powershell
docker compose ps
```
Both `api` and `web` should be running, `db` healthy. Stop with Ctrl+C, then `docker compose down`.

**Ownership questions:**
- Why does only `web` have a port? (Answer: defence in depth. Database and API are not reachable from outside.)
- What does `depends_on ... service_healthy` prevent?
- How does `web` reach `api`? (Answer: Docker's internal DNS resolves the name "api".)

---

#### C7: Minimal automated tests
**Owner:** Copilot writes, you verify.
**Prompt:**
```
Context: backend/ is FastAPI. The repo has no tests. The CEA requires automated
testing. Keep it small and meaningful.

Tasks:
1. Add backend/requirements-dev.txt with: pytest, httpx.
2. Create backend/tests/__init__.py (empty) and backend/tests/test_api_basics.py:
   - test_root_returns_ok: GET "/" returns 200 and status "ok".
   - test_docs_available: GET "/docs" returns 200.
   - test_api_prefix_works: GET "/api/docs" returns 200 (tests StripApiPrefix).
   - test_protected_route_requires_auth: find ONE existing GET route that requires
     authentication (search routers for Depends(get_current_...)) and assert it
     returns 401 or 403 without a token. Name the route in a comment.
   - test_health_returns_json_shape: GET "/health" returns 200 or 503 and JSON
     with key "status". (Allow either, since the DB may be down.)
   Use fastapi.testclient.TestClient(app) WITHOUT a "with" block, so the
   lifespan (scheduler, PostGIS check) does not run.
3. Create backend/pytest.ini with testpaths = tests.
4. Explain each test in cep-notes/C7-tests.md: what it proves and why it matters
   for the report.

Do not hit a real database in these tests.
```
**Verify (you):**
```powershell
cd backend
pip install -r requirements-dev.txt
pytest -q
```
All should pass, or the `/health` test can be 503 without a DB.

**Ownership questions:**
- What is `TestClient` doing?
- Why don't we use `with TestClient(app)`?
- Why is a 401 test valuable for the security section?

---

### PHASE B: Terraform on AWS (Copilot T1 to T3, you run)

Create the folder first (you):
```powershell
mkdir infra
mkdir infra\environments
```

#### T1: Terraform base files and networking
**Owner:** Copilot writes, you run.
**Prompt:**
```
Create Terraform (AWS provider ~> 5.0, Terraform >= 1.6) in /infra. Single
root module, no external modules, so every resource is readable.

Create:
1. infra/versions.tf: terraform block (required_version >= 1.6), required_providers
   aws ~> 5.0 and random ~> 3.6.
2. infra/providers.tf: provider "aws" with region = var.region and default_tags
   {Project = "bloodbridge", ManagedBy = "terraform", Environment = var.environment}.
3. infra/variables.tf: region (default "ap-south-1"), environment (default "dev"),
   vpc_cidr (default "10.0.0.0/16"), web_image_tag, api_image_tag (default
   "bootstrap"), api_desired_count (default 2), web_desired_count (default 2),
   db_instance_class (default "db.t4g.micro"), enable_single_nat (default true).
4. infra/data.tf: data "aws_availability_zones" "available" with state "available",
   and use the first two.
5. infra/networking.tf:
   - aws_vpc with cidr var.vpc_cidr, enable_dns_support and enable_dns_hostnames true
   - 2 public subnets 10.0.1.0/24 and 10.0.2.0/24 (map_public_ip_on_launch true)
   - 2 private app subnets 10.0.11.0/24 and 10.0.12.0/24
   - 2 private db subnets 10.0.21.0/24 and 10.0.22.0/24
   - aws_internet_gateway
   - public route table with 0.0.0.0/0 to the IGW, associated with the public subnets
   - one aws_eip and one aws_nat_gateway in the first public subnet
     (single NAT when enable_single_nat is true; document the trade-off in a comment)
   - private app route table with 0.0.0.0/0 to the NAT; associate app subnets
   - private db route table with NO default route; associate db subnets
   - aws_db_subnet_group for the db subnets
6. infra/security_groups.tf, chained, using security_group_id references only:
   - sg_alb: ingress 80 from 0.0.0.0/0; egress all
   - sg_web: ingress 8080 from sg_alb only; egress all
   - sg_api: ingress 8000 from sg_alb only (ALB routes /api to API); egress all
   - sg_db: ingress 5432 from sg_api only; no egress rule needed beyond default
   Add a description and a Name tag to each.
   NOTE: web tasks also need to reach NAT/internet via the private route table,
   so give sg_web and sg_api egress all.
Add a comment block at the top of networking.tf that draws the subnet layout.
Do not hardcode any secrets. Do not create any database yet.
```
**Verify (you):**
```powershell
cd infra
terraform init
terraform fmt
terraform validate
terraform plan -out=tfplan-net
```
Wait for `Plan: N to add`. Do **not** apply yet, you'll apply everything once the other files are ready (or apply now to save time, which is fine).

**Ownership questions:**
- Why are there three subnet tiers? Which one has a route to the internet and why?
- What is the difference between a route table with a NAT route and one without?
- Why do security groups reference other security groups and not CIDR blocks?

---

#### T2: Database, registry, and secrets
**Owner:** Copilot writes, you run.
**Prompt:**
```
Continue in /infra (versions.tf, providers.tf, variables.tf, networking.tf and
security_groups.tf already exist; reuse their resource names).

Create:
1. infra/rds.tf:
   - random_password "db" (length 32, special = false)  so the URL needs no escaping
   - aws_db_instance:
     identifier = "bloodbridge-${var.environment}", engine "postgres",
     engine_version "16" (or the latest 16.x allowed; pick a version that
     supports PostGIS), instance_class var.db_instance_class,
     allocated_storage 20, storage_encrypted true, db_name "bloodbridge",
     username "bloodbridge_user", password random_password.db.result,
     db_subnet_group_name, vpc_security_group_ids [sg_db], publicly_accessible false,
     multi_az false (comment: set true in prod, cost trade-off),
     backup_retention_period 7, deletion_protection false (comment: true for prod),
     skip_final_snapshot true (comment: false for prod), performance_insights off.
2. infra/ecr.tf: aws_ecr_repository "web" name "bloodbridge-web" and "api" name
   "bloodbridge-api"; image_scanning_configuration scan_on_push true;
   image_tag_mutability "IMMUTABLE"; encryption AES256.
   Add aws_ecr_lifecycle_policy for each keeping the last 10 images.
3. infra/secrets.tf:
   - aws_secretsmanager_secret "database_url" name "bloodbridge/${var.environment}/database-url"
   - aws_secretsmanager_secret_version with secret_string =
     "postgresql://bloodbridge_user:${random_password.db.result}@${aws_db_instance.main.address}:5432/bloodbridge"
   - aws_secretsmanager_secret "jwt_secret" with a random_password (length 64)
     and its version.
   - A secret "app_env" holding the other non-DB settings as a JSON string
     (leave MAIL_* and CLOUDINARY_* empty strings, REQUIRE_EMAIL_VERIFICATION
     "false", FRONTEND_URL set to "http://localhost:8080" as a placeholder
     comment, ADMIN_EMAIL and ADMIN_PASSWORD from random values).
     Mark all secrets sensitive.
4. Do NOT print any secret values in outputs. Do not create a tfvars file with
   secrets. Explain in comments that a real deployment would use a separate
   secret rotation process.
```
**Verify (you):**
```powershell
terraform fmt
terraform validate
terraform plan
```

**Ownership questions:**
- Why is the database password generated by Terraform and never typed by a human?
- Why is `publicly_accessible = false` the most important line in rds.tf?
- Where does the app read DATABASE_URL in the cloud? (Answer: Secrets Manager, injected into the ECS task.)

---

#### T3: ALB, ECS, autoscaling, logging, alarms
**Owner:** Copilot writes, you run.
**Prompt:**
```
Continue in /infra. Existing files: versions, providers, variables, data,
networking, security_groups, rds, ecr, secrets. Reuse their names.

1. infra/alb.tf:
   - aws_lb "main", internal false, load_balancer_type "application", in the
     public subnets, security group sg_alb, idle_timeout 3600 (WebSockets).
   - target group "web": port 8080, protocol HTTP, target_type "ip", vpc,
     health_check path "/" matcher "200-399".
   - target group "api": port 8000, protocol HTTP, target_type "ip", vpc,
     health_check path "/health" matcher "200", interval 15, healthy_threshold 2.
   - listener on port 80, default_action forward to the "web" target group.
   - listener rule (priority 10) with a path_pattern condition ["/api/*"] that
     forwards to the "api" target group.
   - Note in a comment why /api routing lives at the ALB (no service discovery needed).
2. infra/iam.tf:
   - ecs task execution role (AmazonECSTaskExecutionRolePolicy) plus an inline
     policy allowing secretsmanager:GetSecretValue ONLY on the three secret ARNs.
   - ecs task role with no permissions (comment: least privilege; the app does
     not call AWS APIs).
   - Note: if the lab forbids creating IAM roles, say so in a comment and
     reference the LabRole instead (this is a known limitation to document).
3. infra/ecs.tf:
   - aws_ecs_cluster "main" with containerInsights enabled.
   - aws_cloudwatch_log_group for web and api, retention 14 days.
   - aws_ecs_task_definition "web": family bloodbridge-web, network_mode awsvpc,
     requires_compatibilities FARGATE, cpu 256, memory 512, execution and task role,
     container "web" image "${aws_ecr_repository.web.repository_url}:${var.web_image_tag}",
     portMappings 8080, logConfiguration awslogs, essential true.
   - aws_ecs_task_definition "api": family bloodbridge-api, cpu 512, memory 1024,
     container "api" image from the api repo, command ["uvicorn","main:app",
     "--host","0.0.0.0","--port","8000","--workers","2","--proxy-headers",
     "--forwarded-allow-ips=*"], portMappings 8000, environment:
       ENABLE_SCHEDULER=false, TRUST_PROXY=true, REQUIRE_EMAIL_VERIFICATION=false,
       CORS_ORIGINS=http://<alb dns>,
     secrets: DATABASE_URL and JWT_SECRET_KEY and the app_env JSON keys from
     Secrets Manager (use valueFrom with the secret ARN).
     Add lifecycle { ignore_changes = [container_definitions] } so Terraform
     does not revert the image deployed by GitHub Actions. Explain this in a comment.
   - aws_ecs_service "web" and "api": launch_type FARGATE, desired_count from
     variables, network_configuration subnets = private app subnets, security
     group sg_web / sg_api, assign_public_ip false, load_balancer block linking
     the target group, health_check_grace_period_seconds 60,
     deployment_circuit_breaker { enable true rollback true }.
     lifecycle ignore_changes = [desired_count] for api (autoscaling owns it).
4. infra/autoscaling.tf:
   - aws_appautoscaling_target for the api service, min 2, max 4, scalable
     dimension ecs:service:DesiredCount.
   - aws_appautoscaling_policy target tracking on ECSServiceAverageCPUUtilization,
     target_value 60, scale_in_cooldown 120, scale_out_cooldown 60.
5. infra/cloudwatch.tf:
   - alarm "api-unhealthy-targets": metric UnHealthyHostCount on the api target group,
     threshold >= 1 for 2 periods of 60s.
   - alarm "alb-5xx": HTTPCode_ELB_5XX_Count on the ALB > 10 in 5 minutes.
   - alarm "api-cpu-high": ECS CPUUtilization > 80 for the api service.
   - Keep these as the monitoring evidence.
6. infra/outputs.tf: alb_dns_name, ecr_web_url, ecr_api_url, ecs_cluster_name,
   web_service_name, api_service_name, api_task_family, web_task_family,
   private_app_subnet_ids (list), api_security_group_id, rds_endpoint (do NOT
   output any secret).

Keep every resource commented in one line saying what it is for.
```
**Verify (you):**
```powershell
cd infra
terraform fmt
terraform validate
terraform plan -out=tfplan
```
Then apply (takes 15 to 20 minutes, mostly RDS and NAT):
```powershell
terraform apply tfplan
terraform output
```
Save the output into `cep-notes/terraform-outputs.txt` (it contains no secrets; check before you save).

**Ownership questions:**
- Walk me through a request from a browser to the API. (ALB -> listener rule -> target group -> task in private subnet -> RDS.)
- Why does the ECS task need an execution role AND a task role? (Execution pulls images and secrets; task role is what the app can do in AWS.)
- What does `ignore_changes` on container_definitions protect against?
- What happens when CPU goes above 60% on the API?

---

### PHASE C: Push, migrate, first deploy (you, with Copilot commands)

#### Step C-1: Log into ECR and push images manually (once)
Copy the URLs from `terraform output`. Replace the placeholders.
```powershell
$ACCOUNT = (aws sts get-caller-identity --query Account --output text)
$REGION  = "ap-south-1"   # use your region
$ECR     = "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR

$SHA = "manual1"   # first push; the pipeline uses the git SHA later

cd "C:\Users\shahz\OneDrive\Desktop\BloodBridge"
docker build -t "$ECR/bloodbridge-api:$SHA" ./backend
docker build --build-arg EXPO_PUBLIC_API_URL=/api -t "$ECR/bloodbridge-web:$SHA" ./myApp

docker push "$ECR/bloodbridge-api:$SHA"
docker push "$ECR/bloodbridge-web:$SHA"
```
Note: ECR repos are IMMUTABLE, so you can't reuse a tag. Use a new tag like `manual2` if you need to rebuild.

Screenshot: ECR console, both repos, image tag visible, scan result (evidence #12).

#### Step C-2: Update the Terraform image tags and apply
```powershell
cd infra
terraform apply -var "web_image_tag=manual1" -var "api_image_tag=manual1"
```
Services should start. Wait about 3 minutes.

#### Step C-3: Run the migration once (one-off ECS task)
Get values from outputs: cluster, api task family, private subnets, api security group.
```powershell
$CLUSTER = "bloodbridge-cluster"        # use the exact output value
$SUBNETS = "subnet-aaa,subnet-bbb"      # from output private_app_subnet_ids
$SG      = "sg-xxxx"                    # from output api_security_group_id

aws ecs run-task --cluster $CLUSTER --launch-type FARGATE `
  --task-definition bloodbridge-api `
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" `
  --overrides '{\"containerOverrides\":[{\"name\":\"api\",\"command\":[\"alembic\",\"upgrade\",\"head\"]}]}'
```
Note the `taskArn` it prints. Wait for it to finish, then check the exit code:
```powershell
aws ecs wait tasks-stopped --cluster $CLUSTER --tasks TASK_ARN
aws ecs describe-tasks --cluster $CLUSTER --tasks TASK_ARN --query "tasks[0].containers[0].exitCode"
```
Exit code `0` means the migrations ran. Screenshot the CloudWatch log for this task showing alembic output (evidence #15).

#### Step C-4: Open the app
```powershell
cd infra
terraform output alb_dns_name
```
Open `http://<that name>/` in a browser. You should see the BloodBridge web app.
Open `http://<that name>/api/docs` and `http://<that name>/api/health`.

Screenshot: browser showing the app (evidence #17), `/api/health` JSON (evidence #17b), and log in plus create one request (evidence #18).

If the web page is blank: check the web target group health in the ALB console, then CloudWatch logs for `bloodbridge-web`.

**Ownership questions:**
- Why do we run migrations as a separate task and not on container start? (Answer: with 2+ tasks, they would race each other.)
- What is the difference between ECS Service (keeps tasks running) and the one-off run-task? (Answer: service = long-running, run-task = a job that stops.)

---

### PHASE D: CI/CD (Copilot C12 and C13, you set secrets and watch runs)

#### C12: CI workflow
**Owner:** Copilot writes, you verify.
**Prompt:**
```
Create .github/workflows/ci.yml that runs on pull_request and on push to any
branch except main, and also on push to main.

Jobs:
1. backend-test (ubuntu-latest):
   - actions/checkout@v4
   - actions/setup-python@v5 with python-version "3.12", cache pip keyed on backend/requirements*.txt
   - pip install -r backend/requirements.txt -r backend/requirements-dev.txt
   - working-directory backend: pytest -q
   - env: set DATABASE_URL, JWT_SECRET_KEY, FRONTEND_URL, TRUST_PROXY, DB_POOL_SIZE,
     DB_MAX_OVERFLOW, DB_ECHO, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES,
     EMAIL_TOKEN_EXPIRE_MINUTES, REQUIRE_EMAIL_VERIFICATION, MAIL_USERNAME,
     MAIL_PASSWORD, MAIL_FROM, MAIL_PORT, MAIL_SERVER, MAIL_FROM_NAME,
     CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
     ADMIN_EMAIL, ADMIN_PASSWORD, ENABLE_SCHEDULER, SWEEP_INTERVAL_MINUTES
     with CI-only dummy values (never real secrets). Use a dummy DATABASE_URL
     (the tests do not connect to it).
2. frontend-check (ubuntu-latest):
   - actions/checkout@v4, actions/setup-node@v4 with node 22 and cache npm
     with cache-dependency-path myApp/package-lock.json
   - working-directory myApp: npm ci
   - npx tsc --noEmit
   - npm run lint (if this fails on existing code, mark it continue-on-error: true
     and say so in a comment)
3. docker-build (needs backend-test and frontend-check):
   - docker/setup-buildx-action@v3
   - docker build for backend/Dockerfile and myApp/Dockerfile with
     build-args EXPO_PUBLIC_API_URL=/api. Do NOT push. Use load: true or no push.
Use permissions: contents: read only. Add concurrency group ci-${{ github.ref }}
with cancel-in-progress true.
Explain every step in cep-notes/C12-ci.md.
```
**Verify (you):** Push the branch, then check the Actions tab on GitHub. The first run may need small fixes. Paste any error into Copilot Chat with the log.

#### C13: Deploy workflow (build, push, migrate, deploy, smoke test)
**Owner:** Copilot writes, you set secrets and verify.
**Prompt:**
```
Create .github/workflows/deploy.yml.

Trigger: push to main only, plus workflow_dispatch.
Permissions: id-token: write, contents: read (needed for OIDC).
Concurrency: group "deploy-production", cancel-in-progress false.

Use GitHub repository VARIABLES (not secrets) for: AWS_REGION, ECR_WEB_REPO,
ECR_API_REPO, ECS_CLUSTER, WEB_SERVICE, API_SERVICE, WEB_TASK_FAMILY,
API_TASK_FAMILY, PRIVATE_SUBNET_IDS (comma-separated), API_SECURITY_GROUP_ID,
ALB_URL.
Use GitHub SECRET for AWS_ROLE_TO_ASSUME (the IAM role ARN) when OIDC is used.
If OIDC is not available (Learner Lab), instead use secrets AWS_ACCESS_KEY_ID
and AWS_SECRET_ACCESS_KEY, and add a comment showing how to switch.

Steps, in order, in one job named deploy:
1. actions/checkout@v4
2. aws-actions/configure-aws-credentials@v4 (role-to-assume with OIDC, or keys)
3. aws-actions/amazon-ecr-login@v2, output the registry
4. Set IMAGE_TAG to ${{ github.sha }}
5. docker build and push bloodbridge-api from ./backend with tags
   <registry>/<ECR_API_REPO>:<sha>
6. docker build and push bloodbridge-web from ./myApp with build-arg
   EXPO_PUBLIC_API_URL=/api, tag <sha>
7. Render the API task definition: aws ecs describe-task-definition for
   API_TASK_FAMILY, replace the image of container "api" with the new SHA image
   (use aws-actions/amazon-ecs-render-task-definition@v1), save as api-taskdef.json.
   Do the same for the web task.
8. Run the migration ONCE: aws ecs run-task with the NEW api task definition
   (the rendered one, registered first with aws ecs register-task-definition),
   network config from PRIVATE_SUBNET_IDS and API_SECURITY_GROUP_ID,
   overrides command ["alembic","upgrade","head"]. Capture taskArn, then
   aws ecs wait tasks-stopped, then fail the job if exitCode is not 0.
9. Deploy the api service with aws-actions/amazon-ecs-deploy-task-definition@v2,
   wait-for-service-stability true. Then deploy the web service the same way.
10. Smoke test: curl -fsS ${ALB_URL}/api/health and fail if not 200.
    Also curl -fsS ${ALB_URL}/ .
11. Write a summary to $GITHUB_STEP_SUMMARY with the image SHA and the URL.

Never echo secret values. Do not put any credential in the YAML.
Add a comment at the top explaining the rollback: re-run this workflow on an
older commit SHA, or redeploy the previous task definition revision.
Explain every step in cep-notes/C13-deploy.md.
```

**GitHub setup (you do this, 5 minutes):**
1. Repo > **Settings > Secrets and variables > Actions**.
2. **Variables** tab, add: `AWS_REGION`, `ECR_WEB_REPO` (`bloodbridge-web`), `ECR_API_REPO` (`bloodbridge-api`), `ECS_CLUSTER`, `WEB_SERVICE`, `API_SERVICE`, `WEB_TASK_FAMILY` (`bloodbridge-web`), `API_TASK_FAMILY` (`bloodbridge-api`), `PRIVATE_SUBNET_IDS`, `API_SECURITY_GROUP_ID`, `ALB_URL` (`http://<alb dns>`). Values come from `terraform output`.
3. **Secrets** tab, add: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (or `AWS_ROLE_TO_ASSUME` for OIDC).
4. Repo > **Settings > Environments**: create `production` with a protection rule if you like (optional, but nice evidence).

Then merge the branch:
```powershell
git add .
git commit -m "Add containers, Terraform, and CI/CD for CEP"
git push -u origin cep-deploy
```
Open a Pull Request into `main` on GitHub. Watch the **CI** run go green. Merge. Watch the **Deploy** run go green.

**Evidence to screenshot:** green CI run (evidence #13), green Deploy run with the migration step (evidence #14), and a broken-commit demo: push a commit that fails a test, screenshot the red run, then revert.

**Ownership questions:**
- What does `on: push: branches: [main]` do, and why not on every branch for deploy?
- Why is the migration a separate step before the service deploy?
- Why does the pipeline deploy by commit SHA and not by `latest`? (Answer: traceability and rollback.)
- Where does the pipeline get the database URL? (Answer: Secrets Manager, inside the task definition. The pipeline never sees it.)

---

### PHASE E: Scaling proof, monitoring, cost (you, with Copilot for the write-up)

#### E-1: Scaling evidence (10 minutes)
Option 1 (quick): screenshot the ECS service **Auto Scaling** tab showing the target tracking policy (CPU 60, min 2, max 4). Evidence #19.

Option 2 (if time): load test with PowerShell:
```powershell
1..2000 | ForEach-Object -Parallel { Invoke-WebRequest -UseBasicParsing "http://<alb dns>/api/health" | Out-Null } -ThrottleLimit 50
```
(PowerShell 7 needed for `-Parallel`: `winget install Microsoft.PowerShell`.) Then screenshot ECS service task count and CloudWatch CPU graph. Don't spend more than 15 minutes on this.

#### E-2: CloudWatch proof (10 minutes)
1. CloudWatch > Log groups > `/ecs/bloodbridge-api` > screenshot a recent log stream showing requests (evidence #16).
2. CloudWatch > Alarms > screenshot the three alarms (evidence #16b).

#### E-3: Cost estimate (15 minutes, you)
Go to https://calculator.aws, add: Fargate (web 0.25 vCPU / 0.5 GB x2, api 0.5 vCPU / 1 GB x2, hours per month 730), RDS PostgreSQL db.t4g.micro (20 GB storage), ALB (1 LB, low LCU), NAT Gateway (1, low data), ECR (small storage), CloudWatch logs (small), Secrets Manager (3 secrets). Export or screenshot the total.

Give Copilot this prompt to write the cost section:
```
Using the Terraform files in infra/ and this list of monthly usage: [paste your
calculator line items and totals], write a cost section for a technical report.
State assumptions (730 hours, region, task count, storage). Propose exactly two
cost optimisations with a sentence each (for example: right-size Fargate tasks,
single NAT, ECR lifecycle rules, destroy when not in use). Keep it to about 200
words. Mark numbers that I must verify.
```

---

## 7. Commands cheat sheet (you will use these)

```powershell
# Local
cd backend; docker compose up -d db
cd ..; docker compose up --build        # full three-tier local stack
docker compose down                     # stop

# Terraform
cd infra
terraform init
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
terraform output
terraform destroy                       # ONLY after evidence and submission

# AWS checks
aws sts get-caller-identity
aws ecs list-services --cluster <cluster>
aws ecs describe-services --cluster <cluster> --services <api-service>
aws logs tail /ecs/bloodbridge-api --follow

# Git
git checkout -b cep-deploy
git add . ; git commit -m "message" ; git push -u origin cep-deploy
```

---

## 8. Security checklist for the task

### 8.1 Secrets (must be true)
- [ ] `git log -p | Select-String -Pattern "password|secret"` shows no real values (run it, check manually).
- [ ] Only `.env.example` is tracked (`git ls-files | Select-String ".env"`).
- [ ] Docker images contain no `.env` (check `.dockerignore`).
- [ ] No secret in a Dockerfile `ARG` or `ENV`.
- [ ] Terraform `terraform.tfstate` is NOT committed (add `infra/*.tfstate*` and `infra/.terraform/` to `.gitignore`).

Add this to `.gitignore` (you do this):
```
infra/.terraform/
infra/*.tfstate
infra/*.tfstate.*
infra/tfplan*
```

### 8.2 Access
- Use OIDC if your AWS account allows it (best).
- Otherwise use an IAM user with only the permissions the pipeline needs, and note this as a limitation.

---

## 9. Evidence checklist (screenshots)

Save into `evidence/` with the number in the filename. For each one, write in `cep-notes/evidence-log.md`: date, time, region, resource name, what requirement it proves, and anything redacted. Redact account IDs, keys, and personal data.

| # | Screenshot | Proves | Where |
|---|---|---|---|
| 1 | VPC overview with CIDR | Network (1) | VPC console |
| 2 | Public subnets, 2 AZs | Network (1) | VPC > Subnets |
| 3 | Private app subnets | Network (1), segmentation (8) | VPC > Subnets |
| 4 | Private DB subnets | Network (1), segmentation (8) | VPC > Subnets |
| 5 | Internet gateway and public route table | Network (1) | VPC > Route tables |
| 6 | Private route table and NAT gateway | Network (1) | VPC > NAT gateways |
| 7 | ECS cluster with running services | Compute (3, 7) | ECS console |
| 8 | Task definition (image, env, secrets section) | Security (8), containers (2, 3) | ECS > Task definitions |
| 9 | Security groups with chained rules | Security (8) | EC2 > Security groups |
| 10 | ALB listeners and rule for /api/* | Load balancing (7) | EC2 > Load balancers |
| 11 | Target groups with healthy targets | Load balancing (7) | EC2 > Target groups |
| 12 | RDS: engine, subnet group, not publicly accessible | DB (4), security (8) | RDS console |
| 13 | Green CI run | CI/CD (6) | GitHub Actions |
| 14 | Green Deploy run incl. migration step | CI/CD (6) | GitHub Actions |
| 15 | Migration task log showing alembic | DB and deployment (4, 6) | CloudWatch |
| 16 | CloudWatch logs and an alarm | Monitoring (9) | CloudWatch |
| 17 | Browser: deployed web app | Web tier (2) | Browser |
| 18 | Browser: one completed workflow (login, request) | Core function | Browser |
| 19 | Auto-scaling policy (or load test) | Scaling (7), elasticity NFR | ECS > Service > Auto Scaling |
| 20 | ECR repos with commit-SHA tags, scan on | Registry (5) | ECR console |
| 21 | Terraform plan or apply summary | IaC (9) | Terminal |
| 22 | Broken-commit red run | CI/CD gating (6) | GitHub Actions |

---

## 10. Report plan (4 to 6 pages). Write these sections yourself.

The CEA lists the report sections. Use this structure. **Write sections 1, 4, 5, 7 and 8 in your own words**: that's the ownership part examiners look at. You can get Copilot to draft from your `cep-notes/` files, then rewrite.

1. **Introduction** (short): BloodBridge, its users (donors and requestors), the CEP goal.
2. **Existing application** (short): Expo app, FastAPI, PostGIS, Alembic. Why it fits a three-tier design.
3. **Cloud provider and architecture**: why AWS, the diagram, subnets, routing, ALB, ECS, RDS. Explain the `/api` routing decision.
4. **Containerization and CI/CD**: both Dockerfiles, why multi-stage, why non-root, ECR tagging by SHA, the pipeline stages, migrations, rollback.
5. **Security**: chained security groups, private DB, Secrets Manager, OIDC or least-privilege keys, `.dockerignore`, HTTPS status, honest gaps.
6. **Testing and deployment results**: CI results, deploy run, browser evidence, smoke test. Reference evidence numbers.
7. **NFR justification** (its own heading, required). Use this table and fill it in yourself:

| NFR | Decision in our system | Evidence | Limitation / improvement |
|---|---|---|---|
| Scalability | ALB + stateless API tasks + 2 to 4 tasks | #7, #10, #19 | Per-task rate limits and chat broadcaster; add Redis |
| Availability | 2 AZs, 2+ tasks, managed RDS | #2, #7, #12 | Single NAT; RDS not Multi-AZ |
| Elasticity | CPU target tracking | #19 | Load test small or skipped |
| Security | Private tiers, chained SGs, Secrets Manager, least privilege | #8, #9, #12 | HTTP only without a domain; no pen test |
| Maintainability / deployability | Docker, Terraform, CI/CD, SHA tags | #13, #14, #20, #21 | Manual DB restore not automated |
| Performance / latency | ALB health checks, sized tasks, indexed PostGIS queries | #11, #19 | No large load test |
| Cost-efficiency | Small Fargate, single NAT, lifecycle policy, destroy after use | cost section | NAT and ALB fixed costs |
| Portability | Docker images, env-driven config, Terraform | source files | AWS-specific Terraform and secrets |

8. **Cost and conclusion**: estimate, two optimisations, what was not fully done.

Use diagrams and tables, not screenshot dumps.

---

## 11. Final checklist (before you submit)

- [ ] Browser opens the public URL and you complete a real workflow.
- [ ] `/api/health` returns 200 JSON.
- [ ] RDS shows **not publicly accessible**.
- [ ] Latest green CI and Deploy runs exist, and the deploy used a commit SHA.
- [ ] Evidence folder has all 22 items, numbered, with `cep-notes/evidence-log.md` filled in.
- [ ] Architecture diagram is readable (draw.io or Excalidraw, export PNG).
- [ ] Report is 4 to 6 pages, has the NFR section, has the limitations section.
- [ ] Repo link works, and `README.md` has "how to reproduce" steps (the deploy commands from section 7).
- [ ] No secrets in Git (section 8.1).
- [ ] You can answer every "ownership questions" line from every task without looking.
- [ ] Copy of your notes is on your laptop.
- [ ] AWS stays up until your examiner or teacher says otherwise. Then run `terraform destroy` and confirm in the console that resources are gone (cost).

---

## Appendix A: Critical files to paste yourself (if Copilot quota runs out)

### A1. `backend/Dockerfile`
```dockerfile
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

RUN useradd --create-home appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "2", "--proxy-headers", "--forwarded-allow-ips=*"]
```

### A2. `backend/.dockerignore`
```
.venv
__pycache__
*.pyc
.env
.env.*
!.env.example
.git
.pytest_cache
tests
```

### A3. `backend/main.py`: add this class above `app = FastAPI(...)`, and this line after the `CORSMiddleware` block
```python
class StripApiPrefix:
    """Lets one API serve both /donors/... locally and /api/donors/... behind the ALB."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path == "/api" or path.startswith("/api/"):
                scope = dict(scope)
                scope["path"] = path[4:] or "/"
                if scope.get("raw_path"):
                    scope["raw_path"] = scope["raw_path"][4:]
        await self.app(scope, receive, send)

app.add_middleware(StripApiPrefix)   # add AFTER app.add_middleware(CORSMiddleware, ...)
```

### A4. `myApp/nginx.conf`
```nginx
server {
    listen 8080;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json;

    # Local compose only. In AWS the ALB routes /api/* to the API service.
    location /api/ {
        proxy_pass http://api:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    # Expo router pages: fall back to index.html for client-side routes.
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### A5. `myApp/Dockerfile`
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG EXPO_PUBLIC_API_URL=/api
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN npx expo export --platform web

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
```

### A6. `myApp/.dockerignore`
```
node_modules
.expo
dist
.env
.env.*
.git
ios
android
```

### A7. `docker-compose.yml` (repo root)
```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: bloodbridge
      POSTGRES_USER: bloodbridge_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - bloodbridge_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bloodbridge_user -d bloodbridge"]
      interval: 5s
      retries: 10
    networks: [bloodbridge]

  api:
    build: ./backend
    env_file: ./backend/.env
    environment:
      DATABASE_URL: postgresql://bloodbridge_user:${POSTGRES_PASSWORD}@db:5432/bloodbridge
      ENABLE_SCHEDULER: "false"
      TRUST_PROXY: "true"
    depends_on:
      db:
        condition: service_healthy
    networks: [bloodbridge]

  web:
    build:
      context: ./myApp
      args:
        EXPO_PUBLIC_API_URL: /api
    ports:
      - "8080:8080"
    depends_on: [api]
    networks: [bloodbridge]

networks:
  bloodbridge:

volumes:
  bloodbridge_data:
```
Root `.env` (not committed): `POSTGRES_PASSWORD=choose_a_local_password`

### A8. `.gitignore` additions
```
infra/.terraform/
infra/*.tfstate
infra/*.tfstate.*
infra/tfplan*
evidence/
```
(`evidence/` holds screenshots. Keep it out of Git if they contain account details.)

---

## Appendix B: Known gotchas in this repo (read before you hit them)

1. **Two databases:** `backend/.env` uses `localhost:5433` for the local DB. The root compose uses the internal `db:5432`. Don't mix them.
2. **Alembic CHECK constraints** (from SETUP.md): migrations fail if existing rows break the new constraints. Locally, use a fresh DB (`docker compose down -v` deletes the volume, which deletes all local data, so only do this on purpose).
3. **Scheduler:** `ENABLE_SCHEDULER` must be `false` on ECS API tasks. The expire and auto-widen sweeps then need a scheduled call to `POST /blood-requests/admin/expire-overdue` and `/admin/auto-widen`. This is a documented limitation if you skip it. A quick option: an EventBridge schedule plus a small ECS task. If time is short, document it instead.
4. **Rate limiter and chat WebSocket** are per process, so with 2+ tasks they behave per task. Document it in the NFR table.
5. **Web routes vs API routes:** the frontend has `/chat` and `/notifications` pages. That's why the API lives under `/api`. Don't remove the prefix.
6. **Mobile-only features on web:** push notifications and location may not work in the browser. Demo the core flows (login, create request, match, profile), and say so in the report.
7. **Expo `npm ci`:** if the Docker build fails with a lockfile error, run `npm install` locally, commit the updated `package-lock.json`, and rebuild.
8. **Immutable ECR tags:** you cannot push the same tag twice. Use a new tag each time (the pipeline uses the commit SHA, so this is automatic).
9. **Terraform reverts images:** if you run `terraform apply` after the pipeline deploys, the `ignore_changes` on container definitions protects the pipeline's image. Don't remove it.
10. **Migration exit code:** a migration that fails still shows the task as STOPPED. Always check `exitCode` (the pipeline does this).
11. **PostGIS on RDS:** the app calls `ensure_postgis()` on startup and the migrations enable it too. The master user on RDS is allowed to create the extension.
12. **Learner Lab expiry:** when the lab session stops, your credentials and running resources can stop. Start the lab before a demo, and check the RDS and NAT are running.
13. **Costs:** NAT gateway and ALB have fixed hourly charges. Destroy when you're not working on AWS, and always after the evidence is taken.

---

## Appendix C: The three things that most affect your marks

1. **A working public URL served by containers in private subnets, with a DB that is not public.** Check this in a browser and in the RDS console.
2. **A pipeline that really ran.** A green CI run and a green Deploy run with a migration step, and the deploy done by commit SHA.
3. **You can explain it.** Use your `cep-notes/` files for the report and for the viva.
