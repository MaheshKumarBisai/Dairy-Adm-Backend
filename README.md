# 🥛 Dairy Admin Backend (`Dairy-Adm-Backend`)

Dedicated Express backend service for the Admin Portal in the Dairy Marketplace platform.

- **GitHub Repository:** [https://github.com/MaheshKumarBisai/Dairy-Adm-Backend.git](https://github.com/MaheshKumarBisai/Dairy-Adm-Backend.git)
- **Default Port:** `4001`

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
