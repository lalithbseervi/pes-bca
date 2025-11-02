# CORS Proxy Worker

Authentication worker for the PESU LMS system using Cloudflare Workers.

## 🚀 Quick Start

### Local Development

1. **Setup environment variables**:
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars with your actual values
   ```

2. **Start local development server**:
   ```bash
   npm install
   npx wrangler dev --port 8787
   ```

3. **Access the worker**:
   - Local: `http://localhost:8787`
   - Endpoints: `/api/login`, `/api/session`, `/api/logout`

### Production Deployment

1. **Set production secrets** (one-time):
   ```bash
   npx wrangler secret put TURNSTILE_SECRET
   ```

2. **Deploy**:
   ```bash
   npx wrangler deploy
   # OR use the deployment script:
   ./deploy.sh
   ```

## 🔐 Security

**NEVER commit secrets to Git!**

- ✅ Use `.dev.vars` for local development (gitignored)
- ✅ Use `wrangler secret put` for production
- ❌ NEVER put secrets in `wrangler.toml`

See [SECURITY.md](./SECURITY.md) for detailed security guidelines.

## 📋 Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `TURNSTILE_SECRET` | Yes | Cloudflare Turnstile secret key | `1x000...AA` (test) |
| `AUTH_API` | Yes | Authentication API endpoint | `https://api.example.com/auth` |

## 🏗️ Architecture

- **KV Namespace**: `SESSIONS` - Stores session tokens with 72-hour TTL
- **CORS**: Configured for cross-origin requests from frontend
- **Authentication**: Verifies Turnstile + credentials via external API
- **Sessions**: HttpOnly, Secure cookies with SameSite=Lax

## 🔧 Configuration

### Test Keys (Local Development)
Use Cloudflare's test keys that always pass:
- Site Key: `1x00000000000000000000AA`
- Secret: `1x0000000000000000000000000000000AA`

### Production Keys
Get real keys from: https://dash.cloudflare.com/turnstile

## 📚 Documentation

- [SECURITY.md](./SECURITY.md) - Security best practices
- [TURNSTILE_KEYS.md](./TURNSTILE_KEYS.md) - Turnstile configuration guide
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)

## 🐛 Troubleshooting

### CORS Errors
- Check Origin header is properly set
- Verify worker URL matches frontend requests
- Check browser console for specific CORS errors

### Turnstile Errors
- Use test keys for local development
- Verify production keys are configured for your domain
- Check Turnstile dashboard for usage/errors

### Session Issues
- Verify KV namespace binding is correct
- Check cookie settings (HttpOnly, Secure, SameSite)
- Ensure worker URL uses HTTPS in production

## 📝 API Endpoints

### POST /api/login
Authenticate user and create session.

**Request:**
```json
{
  "srn": "PES1UG20CS123",
  "password": "secret",
  "turnstileToken": "token-from-widget"
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "srn": "PES1UG20CS123",
    "profile": { "name": "John Doe", "branch": "CSE" },
    "expiresAt": "2025-10-15T12:00:00Z"
  }
}
```

### GET /api/session
Verify current session.

**Response:**
```json
{
  "success": true,
  "session": { /* session data */ }
}
```

### POST /api/logout
Clear session and logout.

**Response:**
```json
{
  "success": true
}
```

## 📄 License

Same as parent project.
