# Grafana UI for Tempo - Quick Start Guide

## ✅ Grafana is Running!

**Access Grafana:** http://localhost:3001

**Default Login:**
- Username: `admin`
- Password: `admin` (you'll be prompted to change it on first login)

## 📊 Configure Tempo Data Source

### Option 1: Via UI (Recommended)

1. Open http://localhost:3001
2. Login with `admin` / `admin`
3. Go to **Configuration** (gear icon) → **Data Sources**
4. Click **Add data source**
5. Search for **Tempo** and select it
6. Configure:
   - **Name:** Tempo
   - **URL:** `http://tempo:3200`
   - **Access:** Proxy
   - Enable **Node Graph**
   - Click **Save & Test**

### Option 2: Via API (Already Done)

The Tempo data source should already be configured. If not, you can add it via API:

```bash
curl -X POST http://localhost:3001/api/datasources \
  -H "Content-Type: application/json" \
  -u admin:admin \
  -d '{
    "name": "Tempo",
    "type": "tempo",
    "url": "http://tempo:3200",
    "access": "proxy",
    "isDefault": true
  }'
```

## 🔍 View Traces

1. Click **Explore** icon (compass) in the left sidebar
2. Select **Tempo** from the data source dropdown
3. Search for traces:
   - **Service name:** `qa-pr-dashboard-api`
   - **Trace ID:** (paste any trace ID)
   - Use time range picker to filter
4. Click on any trace to see:
   - Timeline view
   - Service map
   - Span details
   - Tags and logs

## 🎯 Quick Search Examples

- **By Service:** Type `qa-pr-dashboard-api` in search
- **By Trace ID:** Paste trace ID from your API logs
- **Time Range:** Use the time picker to see recent traces

## 📈 What You'll See

- **Trace Timeline:** Visual representation of all spans
- **Service Map:** Shows service dependencies
- **Span Details:** Click any span to see:
  - Duration
  - Tags
  - Logs (if correlated)
  - Parent/Child relationships

## 🔗 Alternative: Your Flow Visualization UI

You also have a built-in Flow Visualization in your app:
- Go to http://localhost:3000
- Navigate to **K8s Management** → **Flow Tracing**
- View traces with correlated K8s logs

## 🛠️ Troubleshooting

If Tempo data source is not working:
1. Check Tempo is running: `podman ps | grep tempo`
2. Verify network: Both containers should be on `tracing-network`
3. Test Tempo API: `curl http://localhost:3200/ready`



