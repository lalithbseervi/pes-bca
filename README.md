# pes-bca

A modern, serverless learning management system built with **Cloudflare Workers**, **Cloudflare Pages**, and **Supabase**.

## 🏗️ Architecture

### Stack
- **Frontend**: Static HTML/CSS/JS deployed on **Cloudflare Pages**
- **API & Proxy**: **Cloudflare Workers** with Wrangler
- **Database**: Supabase PostgreSQL for incidents & status page
- **Object Storage**: Supabase Storage for resource files
- **Key-Value Store**: Cloudflare KV for session management, caching, configuration
- **D1 Database**: Cloudflare D1 for user registry & sessions
- **SSR/Templates**: Zola static site generator for content

### Key Services
- **`/api/login/`** – API Endpoint for authenticating with pesuacademy (for more info, see `https://pesu-auth.onrender.com`)
- **`/api/system/status/stream`** – SSE endpoint for real-time maintenance mode & announcements
- **`/api/system/status`** – JSON endpoint for system status (maintenance, messages, version)
- **`/api/resources`** – Fetch course resources filtered by user's enrolled course
- **`/api/subjects`** – List all available subjects & course mappings
- **`/api/subject/{code}`** – Get resources for a specific subject
- **Admin endpoints** – Create/update subjects, resources, components, and incidents (authenticated)

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ (with npm or yarn)
- **Wrangler CLI** (Cloudflare Workers toolkit): `npm install -g wrangler`
- **Git** for version control
- Cloudflare account with Workers & Pages enabled
- Supabase project for PostgreSQL & Storage
- D1 database (Cloudflare's SQLite offering)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/lalithbseervi/notes.git
   cd lms
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd cors-proxy && npm install && cd ..
   ```

3. **Configure environment**
   - Copy `.env.example` to `.env` (if present) or create `cors-proxy/wrangler.toml` with:
     ```toml
     [env.development]
     vars = { API_BASE_URL = "http://localhost:8787" }
     kv_namespaces = [
        { binding = "SESSION", id = "your-kv-id", preview_id= "your-preview-id" },
        { binding = "CONFIG_KV", id = "your-kv-id", preview_id = "your-preview-id" }
     ]
     d1_databases = [
       { binding = "USER_DB", database_id = "your-db-id", preview_database_id = "your-preview-db-id" }
     ]
     ```
   - Set Supabase URL, service role key, and JWT secret in environment variables.

4. **Initialize D1 database**
   ```bash
   cd db && bash setup-d1.sh && cd ..
   ```

5. **Run locally**
   ```bash
   npm run dev
   ```
   - **Frontend** (Zola): `http://localhost:1111`
   - **Worker**: `http://localhost:8787`

## 📁 Project Structure

```
.
├── config.toml                 # Zola config for static site
├── content/                    # Course markdown files (Zola)
│   ├── _index.md
│   ├── posts/
│   ├── sem-1/, sem-2/, sem-3/  # Semester content (the `sem-{N}` folders are now redundant, see cors-proxy/api/subject-page.js)
│   └── ...
├── templates/                  # HTML templates (Zola)
│   ├── index.html
│   ├── subject.html            # Subject page template
│   ├── admin.html
│   └── ...
├── static/                     # Deployed static assets
│   ├── js/
│   │   ├── system-notifications.js   # SSE client for maintenance alerts
│   │   ├── init/subject.js           # Subject page initialization
│   │   └── ...
│   ├── css/
│   └── ...
├── cors-proxy/                 # Cloudflare Worker
│   ├── wrangler.toml           # Worker config
│   ├── src/
│   │   ├── index.js            # Router & request handler
│   │   ├── api/
│   │   │   ├── system-status-stream.js    # SSE for maintenance mode
│   │   │   ├── resources.js               # Fetch resources by course
│   │   │   ├── subject.js                 # Subject endpoints
│   │   │   ├── admin.js                   # Admin operations
│   │   │   ├── login.js, logout.js        # Auth handlers
│   │   │   └── ...
│   │   └── utils/
│   │       ├── auth-helpers.js       # Centralized auth logic
│   │       ├── course.js             # Course resolution
│   │       └── ...
│   └── package.json
├── db/                         # D1 schema migrations
│   ├── setup-d1.sh
│   ├── 002_subjects_table.sql
│   └── ...
└── scripts/                    # Utility scripts (migrations, updates)
```

## 🔧 Development

### Running the Worker Locally
```bash
cd cors-proxy
npm run dev
```
Accesses the Worker at `http://localhost:8787`.

### Hot Reloading
- Wrangler watches `src/` for changes and recompiles.
- Browser auto-refresh may be needed; some SSE changes require a restart.

### Building Static Site
```bash
# Generate content from Zola templates
zola build

# Output: public/
```

## 🔐 Authentication & Authorization

### Auth Flow
1. **Login** → `/api/login` (email + password)
   - Returns JWT token in `access_token` httpOnly cookie
   - Also provides `refresh_token` for long-lived sessions

2. **Protected Routes** → Check `access_token` cookie or `Authorization: Bearer <token>` header
   - Use `authenticateRequest()` helper to extract, verify, and resolve user's course

3. **Admin Access** → Requires `X-Admin-Passphrase` header + valid JWT with admin role

### Key Functions
- **`authenticateRequest(request, env, {requireCourse})`** – Centralized auth in `utils/auth-helpers.js`
  - Extracts JWT from cookie or header
  - Verifies signature with `JWT_SECRET`
  - Optionally resolves user's course from profile
  - Returns `{ok, payload, profile, course}` or `{ok: false, status, error}`

## 📡 Real-Time Updates

### System Status Stream (SSE)
- **Endpoint**: `GET /api/system/status/stream`
- **Type**: Server-Sent Events
- **Updates**:
  - Initial status on connect
  - Change-only updates every 30s
  - Heartbeat ping every 30s to keep connection alive
- **Client**: `static/js/system-notifications.js`
  - Listens for `status` event
  - Shows/hides maintenance banner
  - Auto-reconnects on disconnect

### Polling Fallback
- If SSE unavailable, client falls back to `GET /api/system/status` (JSON, no caching issues)

## 🚢 Deployment

### To Cloudflare Workers (cors-proxy)
```bash
cd cors-proxy
npm run deploy
```
- Deploys to your Cloudflare account (requires `wrangler login`)
- Environment: reads from `wrangler.toml` and secrets via `wrangler secret put KEY VALUE`

### To Cloudflare Pages (frontend)
```bash
npm run build
# (or automatic via GitHub Actions on push to main)
```
- Zola generates `public/` → deployed to Pages
- Set custom domain in Pages dashboard

### Environment Secrets (Production)
Set these via `wrangler secret put`:
```bash
wrangler secret put JWT_SECRET
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put STATUS_ADMIN_PASSPHRASE
wrangler secret put KV_RATE_LIMIT_ID
```

## 🧪 Testing

```bash
# Start dev server
npm run dev

### Auth Test
```bash
# Login
curl -X POST http://localhost:8787/api/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@pesu.edu", "password": "password"}'

# Use returned cookie in subsequent requests
curl http://localhost:8787/api/resources \
  -H "Cookie: access_token=<token>"
```

## 🐛 Troubleshooting

### Maintenance Banner Not Showing
- **Cause**: CONFIG_KV not populated, or SSE not connecting
- **Fix**:
  1. Verify KV has `config:maintenance_mode` set to `"true"`
  2. Check EventSource in browser DevTools → Network → system/status/stream
  3. Ensure client `API_BASE_URL` is correct
  4. Look for CORS errors in console

### Wrangler Remote Dev Timeout
- **Cause**: Network firewall or VPN blocking Cloudflare tunnel
- **Fix**: Use local-only dev:
  ```bash
  npx wrangler dev --local --port 8787
  ```

## 📚 Key Endpoints Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/system/status` | No | System status (JSON) |
| GET | `/api/system/status/stream` | No | Real-time status (SSE) |
| POST | `/api/login` | No | Authenticate user |
| POST | `/api/logout` | Yes | Clear session |
| GET | `/api/resources` | Yes | User's course resources |
| GET | `/api/subjects` | Yes | All subjects |
| GET | `/api/subject/{code}` | No | Specific subject resources |
| POST | `/api/admin/subjects` | Yes + Admin | Create subject |
| PATCH | `/api/admin/subjects/:id` | Yes + Admin | Update subject |
| DELETE | `/api/admin/subjects/:id` | Yes + Admin | Delete subject |
| POST | `/api/status/incidents` | Yes + Passphrase | Create incident |
| PATCH | `/api/status/components/:id` | Yes + Passphrase | Update component |

## 🤝 Contributing

1. **Create a feature branch**: `git checkout -b feature/your-feature`
2. **Make changes** and test locally with `npm run dev`
3. **Commit with clear messages**: `git commit -m "feat: add feature"`
4. **Push and open a pull request**

## 🆘 Support & Contact

For issues, bugs, or feature requests, contact the development team or open an issue on the internal repository.

---
