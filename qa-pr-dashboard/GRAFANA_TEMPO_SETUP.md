# Grafana UI for Tempo Traces

## Access Grafana UI

**URL:** http://localhost:3001

**Login:** 
- Username: `admin`
- Password: `admin` (change on first login, or use anonymous access if enabled)

## Configure Tempo Data Source

1. Go to **Configuration** → **Data Sources**
2. Click **Add data source**
3. Search for **Tempo**
4. Configure:
   - **Name:** Tempo
   - **URL:** http://tempo:3200
   - Click **Save & Test**

## View Traces

1. Go to **Explore** (compass icon in left sidebar)
2. Select **Tempo** data source
3. Use the search bar to find traces:
   - Search by service name: `qa-pr-dashboard-api`
   - Search by trace ID
   - Use time range picker to filter by time
4. Click on a trace to see detailed view

## Quick Start

1. Open http://localhost:3001
2. Go to **Explore** → Select **Tempo**
3. Search for traces from `qa-pr-dashboard-api`
4. Click any trace to see the full trace timeline

## Alternative: Use Your Flow Visualization UI

Your application also has a built-in Flow Visualization UI:
- Go to http://localhost:3000
- Navigate to **K8s Management** → **Flow Tracing** tab
- View traces with correlated K8s logs



