# Jira Sync Troubleshooting Guide

## Common Issues and Solutions

### 1. **Unable to Sync - Check Configuration**

**Steps to verify:**
1. Open **Settings** in the dashboard
2. Verify all required fields are filled:
   - **Base URL**: Should be `https://your-domain.atlassian.net` (no trailing slash)
   - **Email**: Your Jira account email
   - **API Token**: Your Jira API token (get from: https://id.atlassian.com/manage-profile/security/api-tokens)
   - **Project Key**: The project key (e.g., `PROJ`, `HSP`) - **Use "List Projects" button to find the correct key**

### 2. **Error: "Project not found" (404/410)**

**Solution:**
- Click **"List Projects"** button next to Project Key field in Settings
- Select the correct project from the list
- The project key will be auto-filled

### 3. **Error: "Invalid credentials" (401)**

**Check:**
- Email is correct (the one you use to log into Jira)
- API Token is valid and not expired
- Generate new token if needed: https://id.atlassian.com/manage-profile/security/api-tokens

### 4. **Error: "Access forbidden" (403)**

**Solution:**
- Your account may not have permission to access the project
- Contact your Jira administrator to grant access
- Verify you can access the project in the Jira web interface

### 5. **Error: "Invalid request payload" or "JQL query error"**

**Common causes:**
- Invalid project key
- Special characters in project key
- Invalid label format

**Solution:**
- Use "List Projects" to get the correct project key
- Labels should be comma-separated (e.g., `label1, label2`)
- Project key should not contain spaces or special characters

### 6. **Error: "Cannot connect to Jira server"**

**Check:**
- Base URL is correct (should start with `https://` or `http://`)
- No trailing slash at the end
- Your network connection
- Jira server is accessible from your network

### 7. **No Issues Returned**

**Possible reasons:**
- Project has no issues
- Labels filter is too restrictive
- Issues are archived

**Solution:**
- Try syncing without labels first
- Check if project has issues in Jira web interface
- Verify labels exist in Jira

## Step-by-Step Sync Process

1. **Configure Settings:**
   ```
   - Open Settings
   - Enter Base URL (e.g., https://coredge-jira.atlassian.net)
   - Enter your Email
   - Enter API Token
   - Click "List Projects" to find and select Project Key
   - (Optional) Enter Labels (comma-separated)
   - Click "Save"
   ```

2. **Sync Jira:**
   ```
   - Click "Sync Jira" button
   - Wait for sync to complete
   - Check server logs for detailed information
   ```

3. **Verify Results:**
   ```
   - Check dashboard for synced issues
   - Issues are linked to PRs based on Jira key in PR title/body
   - View in PR table
   ```

## Debugging

**Check Server Logs:**
- All requests are logged with full details
- Look for error messages in the API server terminal
- Error messages include specific troubleshooting steps

**Verify Credentials:**
```bash
# Test connection manually (if needed)
curl -u "email:apiToken" https://your-domain.atlassian.net/rest/api/3/myself
```

## API Endpoints Used

1. **Connection Test:** `GET /rest/api/3/myself`
2. **List Projects:** `GET /rest/api/3/project`
3. **Verify Project:** `GET /rest/api/3/project/{projectKey}`
4. **Search Issues:** 
   - Primary: `POST /rest/api/3/search/jql`
   - Fallback: `POST /rest/api/3/search`

## Support

If issues persist:
1. Check server console logs for detailed error messages
2. Verify all credentials are correct
3. Test with "List Projects" to verify connection
4. Try syncing without labels first

