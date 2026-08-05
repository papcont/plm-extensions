# Deployment Guide

This guide covers deployment options for the Fusion Manage to Dolibarr BOM Integration Service.

## Local Development

### Prerequisites
- Node.js 16+ and npm
- Git (optional)

### Setup Steps

1. **Clone or download the project**
   ```powershell
   cd c:\Antigravity\ERP
   ```

2. **Install dependencies**
   ```powershell
   npm install
   ```

3. **Configure environment**
   ```powershell
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Start the service**
   ```powershell
   # Production mode
   npm start
   
   # Development mode (with auto-reload)
   npm run dev
   ```

5. **Test the service**
   ```powershell
   curl http://localhost:3000/health
   ```

---

## Production Deployment

### Option 1: Windows Server

#### Using PM2 Process Manager

1. **Install PM2 globally**
   ```powershell
   npm install -g pm2
   ```

2. **Start the service with PM2**
   ```powershell
   cd c:\Antigravity\ERP
   pm2 start src/server.js --name fusion-dolibarr-integration
   ```

3. **Configure PM2 to start on boot**
   ```powershell
   pm2 startup
   pm2 save
   ```

4. **Monitor the service**
   ```powershell
   pm2 status
   pm2 logs fusion-dolibarr-integration
   pm2 monit
   ```

#### Using Windows Service (NSSM)

1. **Download NSSM** from https://nssm.cc/download

2. **Install as Windows Service**
   ```powershell
   nssm install FusionDolibarrIntegration "C:\Program Files\nodejs\node.exe" "c:\Antigravity\ERP\src\server.js"
   nssm set FusionDolibarrIntegration AppDirectory "c:\Antigravity\ERP"
   nssm start FusionDolibarrIntegration
   ```

---

### Option 2: Docker Deployment

#### Create Dockerfile

Create `Dockerfile` in the project root:

```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]
```

#### Create docker-compose.yml

```yaml
version: '3.8'

services:
  fusion-dolibarr-integration:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
```

#### Deploy with Docker

```powershell
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

---

### Option 3: Cloud Deployment

#### Azure App Service

1. **Create App Service**
   ```powershell
   az webapp create --resource-group myResourceGroup --plan myAppServicePlan --name fusion-dolibarr-integration --runtime "NODE|16-lts"
   ```

2. **Configure environment variables**
   ```powershell
   az webapp config appsettings set --resource-group myResourceGroup --name fusion-dolibarr-integration --settings FUSION_CLIENT_ID=xxx FUSION_CLIENT_SECRET=xxx ...
   ```

3. **Deploy code**
   ```powershell
   az webapp deployment source config-zip --resource-group myResourceGroup --name fusion-dolibarr-integration --src deployment.zip
   ```

#### AWS EC2

1. **Launch EC2 instance** (Ubuntu/Amazon Linux)

2. **Install Node.js**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Clone and setup**
   ```bash
   git clone <your-repo>
   cd fusion-dolibarr-integration
   npm install
   cp .env.example .env
   # Edit .env
   ```

4. **Use PM2 for process management**
   ```bash
   npm install -g pm2
   pm2 start src/server.js --name fusion-dolibarr-integration
   pm2 startup
   pm2 save
   ```

---

## Webhook Configuration

### Development (ngrok)

1. **Install ngrok**
   Download from https://ngrok.com/download

2. **Start ngrok tunnel**
   ```powershell
   ngrok http 3000
   ```

3. **Update .env**
   ```env
   WEBHOOK_CALLBACK_URL=https://your-ngrok-url.ngrok.io/webhook/fusion-manage
   ```

4. **Restart service**

### Production

1. **Configure reverse proxy** (nginx, IIS, etc.)

2. **Set up SSL certificate** (Let's Encrypt, etc.)

3. **Update .env with public URL**
   ```env
   WEBHOOK_CALLBACK_URL=https://your-domain.com/webhook/fusion-manage
   ```

#### Example nginx configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## Security Considerations

### Production Checklist

- [ ] Use strong API keys and secrets
- [ ] Enable HTTPS/SSL for webhook endpoint
- [ ] Implement API authentication for transfer endpoints
- [ ] Restrict network access (firewall rules)
- [ ] Regular security updates (`npm audit`)
- [ ] Monitor logs for suspicious activity
- [ ] Backup database regularly
- [ ] Use environment-specific configurations
- [ ] Implement rate limiting
- [ ] Enable CORS only for trusted domains

### Environment Variables Security

Never commit `.env` to version control. Use:
- Azure Key Vault
- AWS Secrets Manager
- HashiCorp Vault
- Or encrypted environment variables

---

## Monitoring & Maintenance

### Log Management

**Rotate logs** to prevent disk space issues:

```javascript
// In src/utils/logger.js, already configured:
maxsize: 5242880, // 5MB
maxFiles: 5
```

### Database Backup

```powershell
# Backup SQLite database
cp data/transfers.db data/transfers.db.backup

# Scheduled backup (Windows Task Scheduler)
# Create a PowerShell script for automated backups
```

### Health Monitoring

Set up monitoring for:
- `/health` endpoint (should return 200)
- Log files for errors
- Database size
- API response times

Tools:
- UptimeRobot
- Pingdom
- New Relic
- Application Insights (Azure)

---

## Scaling Considerations

### Horizontal Scaling

For high-volume deployments:

1. **Load balancer** in front of multiple instances
2. **Shared database** (PostgreSQL instead of SQLite)
3. **Redis** for distributed locking
4. **Message queue** (RabbitMQ, Redis) for async processing

### Performance Optimization

- Enable caching for Fusion Manage API responses
- Batch BOM transfers during off-peak hours
- Implement connection pooling
- Use compression for API responses

---

## Troubleshooting

### Service won't start

```powershell
# Check Node.js version
node --version

# Check for missing dependencies
npm install

# Verify environment variables
cat .env

# Check logs
cat logs/integration.log
```

### Webhook not receiving events

1. Verify public URL is accessible
2. Check webhook registration: `GET /webhook/status`
3. Test with ngrok first
4. Check Fusion Manage webhook logs

### Database locked errors

SQLite doesn't handle high concurrency well. Consider:
- Upgrading to PostgreSQL
- Implementing retry logic
- Using WAL mode for SQLite

---

## Rollback Procedure

If deployment fails:

1. **Stop the service**
   ```powershell
   pm2 stop fusion-dolibarr-integration
   ```

2. **Restore previous version**
   ```powershell
   git checkout <previous-commit>
   npm install
   ```

3. **Restore database backup**
   ```powershell
   cp data/transfers.db.backup data/transfers.db
   ```

4. **Restart service**
   ```powershell
   pm2 start fusion-dolibarr-integration
   ```
