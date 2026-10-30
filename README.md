# 🥛 Dairy Admin Backend (`Dairy-Adm-Backend`)

Dedicated Express backend service for the Admin Portal in the Dairy Marketplace platform.

- **GitHub Repository:** [https://github.com/MaheshKumarBisai/Dairy-Adm-Backend.git](https://github.com/MaheshKumarBisai/Dairy-Adm-Backend.git)
- **Default Port:** `4001`

---

## 🏗️ System Architecture & AWS Infrastructure

![System Architecture](docs/architecture.png)

### Architecture Overview & Admin Backend Role

The platform runs inside a secure **AWS VPC** across public and private subnets:

1. **Ingress & Networking**:
   - **Route 53 & Internet Gateway**: Resolves and routes public internet traffic to the VPC.
   - **Application Load Balancer (ALB)** (Public Subnet): Routes administrative traffic (`/api/admin/*`) directly to this **Admin Backend** running on port `4001` in a dedicated Private Subnet, and web UI traffic to **Admin Frontend**.

2. **Backend & Service Integration (Private Subnet)**:
   - **Admin Backend (Express)**: Manages admin authentication, live order status changes, partner dispatch, and inventory analytics.
   - **Amazon RDS (PostgreSQL)**: Direct connection via Prisma ORM for operational queries and live order transactions.
   - **Main Backend (NestJS)**: Auto-scaled backend handling customer subscription pipelines and mobile APIs.

3. **Storage & Media Processing**:
   - **AWS Lambda ("Image Processing Function")**: Serverless handler invoked to process, crop, and optimize product and banner images uploaded through the admin portal.
   - **Amazon S3**: High-durability object storage for all product photos, catalog assets, and media.

---

## 📋 Prerequisites
Before running on a new laptop, ensure:
1. **Node.js**: `v20.x` or higher (`node -v`)
2. **npm**: `v10.x` or higher (`npm -v`)
3. **PostgreSQL Database**: Running on port `5433` (started via `Dairy-Backend` Docker container)
4. **Git**: Installed (`git --version`)

---

## ⚡ Step-by-Step Local Setup Guide

Run these commands in order in your terminal:

### 1. Clone the Repository
```bash
git clone https://github.com/MaheshKumarBisai/Dairy-Adm-Backend.git
cd Dairy-Adm-Backend
```

### 2. Setup Environment Variables
Create your local `.env` configuration file from the template:
```bash
cp .env.example .env
```

Default settings in `.env`:
```env
ADMIN_PORT=4001
MAIN_BACKEND_URL=http://localhost:4000
DATABASE_URL="postgresql://dairy_user:dairy_password@localhost:5433/dairy_db?schema=public"
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Generate Prisma Client
```bash
npx prisma generate
```

### 5. Start the Server
```bash
npm start
```

The Admin Backend is now live at **http://localhost:4001**!

---

## 🔍 Verify Installation
- **Health Check:** [http://localhost:4001/api/admin/health](http://localhost:4001/api/admin/health)
- **Live SSE Events Stream:** [http://localhost:4001/api/admin/events](http://localhost:4001/api/admin/events)
