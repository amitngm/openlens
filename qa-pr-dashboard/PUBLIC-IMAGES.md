# Making Docker Images Public on Docker Hub

## Default Behavior

**Docker Hub repositories are PUBLIC by default** on free accounts. When you push images to Docker Hub, they are automatically public unless you explicitly create a private repository.

## Verify Public Visibility

### Option 1: Via Web Interface

1. Go to your Docker Hub repositories:
   - `https://hub.docker.com/r/<your-username>/qa-pr-dashboard-frontend`
   - `https://hub.docker.com/r/<your-username>/qa-pr-dashboard-api`

2. Check the visibility badge:
   - **Public** badge = Image is public ✅
   - **Private** badge = Image is private (requires paid plan)

3. To change visibility (if needed):
   - Go to **Settings** → **Repository Visibility**
   - Select **Public**
   - Click **Update**

### Option 2: Via Docker Hub CLI

```bash
# Install Docker Hub CLI (if not already installed)
# macOS: brew install docker/hub/hub-cli
# Or download from: https://github.com/docker/hub-tool

# Make repositories public
docker hub repo update <your-username>/qa-pr-dashboard-frontend --visibility public
docker hub repo update <your-username>/qa-pr-dashboard-api --visibility public
```

### Option 3: Using the Script

```bash
./make-public.sh <your-username>
```

## Creating Public Repositories

When you push an image for the first time, Docker Hub automatically creates the repository as **PUBLIC** by default.

### First Push

```bash
# Build and push (creates public repositories automatically)
./build-and-push.sh <your-username>
```

The repositories will be created as public and anyone can pull your images using:
```bash
docker pull <your-username>/qa-pr-dashboard-frontend:latest
docker pull <your-username>/qa-pr-dashboard-api:latest
```

## Checking if Images are Public

### Test Public Access

Try pulling the image without authentication:
```bash
# This should work if the image is public
docker pull <your-username>/qa-pr-dashboard-frontend:latest
```

If it works without login, the image is public ✅

### View Public Images

Visit the repository URL in an incognito/private browser window:
- `https://hub.docker.com/r/<your-username>/qa-pr-dashboard-frontend`
- `https://hub.docker.com/r/<your-username>/qa-pr-dashboard-api`

If you can see the repository details without logging in, it's public ✅

## Private vs Public

### Free Account
- **Public repositories**: Unlimited ✅
- **Private repositories**: 1 free private repository
- **Default**: All repositories are PUBLIC

### Paid Account (Pro/Team)
- **Public repositories**: Unlimited
- **Private repositories**: Unlimited
- Can set repositories to private

## Making Existing Private Repositories Public

If you have a paid account and created private repositories:

1. Go to repository **Settings**
2. Find **Repository Visibility**
3. Change from **Private** to **Public**
4. Click **Update**

**Note**: Making a repository public is **irreversible** on free accounts. Once public, it stays public.

## Best Practices for Public Images

1. **Don't include secrets** in Docker images
2. **Use environment variables** for sensitive data
3. **Use .dockerignore** to exclude sensitive files
4. **Scan images** for vulnerabilities
5. **Use specific tags** (not just `latest`) for production
6. **Document** what the image contains

## Example: Public Image Usage

Once your images are public, anyone can use them:

```bash
# Pull public images
docker pull <your-username>/qa-pr-dashboard-frontend:latest
docker pull <your-username>/qa-pr-dashboard-api:latest

# Use in docker-compose.yml
services:
  frontend:
    image: <your-username>/qa-pr-dashboard-frontend:latest
  api:
    image: <your-username>/qa-pr-dashboard-api:latest
```

## Troubleshooting

### Image shows as Private
- Check if you have a paid Docker Hub account
- Verify repository settings
- Free accounts default to public

### Cannot make repository public
- Free accounts: All repositories are public by default
- Paid accounts: You can toggle between public/private
- Check your Docker Hub plan

### Want to keep images private
- Upgrade to Docker Hub Pro/Team plan
- Or use a private registry (GitHub Container Registry, AWS ECR, etc.)

