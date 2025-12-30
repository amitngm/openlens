# Viewing Search Traces in Jaeger

This guide explains how to view and filter traces based on search operations in Jaeger UI.

## Overview

The tracing middleware automatically tags search operations with specific attributes that allow you to filter and view search-related traces in Jaeger. When you perform a search in the application, the traces are tagged with:

- `operation.name`: The type of search operation (e.g., `search_flows`, `search_pods`)
- `ui.event`: The UI event that triggered the search (e.g., `flow_search`, `pod_search`)
- `operation.type`: Always set to `search` for search operations
- `search.term`: The search term used (if available)
- `search.resource_type`: The type of resource being searched (e.g., `flow`, `pod`, `pull_request`)
- `search.namespace`: The Kubernetes namespace (if applicable)

## Accessing Jaeger UI

1. Open Jaeger UI: **http://localhost:16686**
2. Ensure Jaeger is running: `podman ps | grep jaeger`

## Filtering Search Traces

### Method 1: Filter by Operation Name

1. In Jaeger UI, go to the **Search** tab
2. Select **Service**: `qa-pr-dashboard-api`
3. In the **Tags** field, enter:
   ```
   operation.type=search
   ```
4. Click **Find Traces**

This will show all search operations.

### Method 2: Filter by Specific Search Type

To see only flow searches:
```
operation.name=search_flows
```

To see only pod searches:
```
operation.name=search_pods
```

To see PR searches:
```
operation.name=search_prs
```

### Method 3: Filter by Search Term

To find traces for a specific search term:
```
search.term=testingk8s
```

### Method 4: Filter by Resource Type

To see searches for a specific resource type:
```
search.resource_type=pod
```

### Method 5: Filter by Namespace

To see searches in a specific namespace:
```
search.namespace=ccs
```

### Method 6: Combine Multiple Filters

You can combine multiple tags using AND logic:
```
operation.type=search AND search.resource_type=pod AND search.namespace=ccs
```

## Search Operation Types

The following search operations are automatically tagged:

| Operation Name | UI Event | Resource Type | Description |
|---------------|----------|---------------|-------------|
| `search_flows` | `flow_search` | `flow` | Search for flow traces |
| `search_pods` | `pod_search` | `pod` | Search for Kubernetes pods |
| `search_prs` | `pr_search` | `pull_request` | Search for pull requests |
| `search_history` | `view_search_history` | `search_history` | View search history |
| `search_pods` | `k8s_pods_search` | `pod` | Kubernetes pod search |
| `search_services` | `k8s_services_search` | `service` | Kubernetes service search |
| `search_deployments` | `k8s_deployments_search` | `deployment` | Kubernetes deployment search |

## Viewing Trace Details

When you click on a trace, you can see:

1. **Timeline View**: Shows all service calls in chronological order
2. **Span Details**: Click on any span to see:
   - **Tags**: All attributes including search context
   - **Logs**: Any log entries
   - **Process**: Service information
3. **Service Dependencies**: See which services were called during the search

## Example: Finding a Specific Search

Let's say you searched for "testingk8s" in the Flow Visualization:

1. Open Jaeger UI
2. Set **Service** to: `qa-pr-dashboard-api`
3. Set **Tags** to: `search.term=testingk8s`
4. Set **Lookback** to: Last 1 hour
5. Click **Find Traces**

You'll see all traces related to that search, including:
- The initial search request
- Any Kubernetes API calls to find pods
- Any log queries
- Any trace collection operations

## Tips

1. **Time Range**: Use appropriate lookback time (Last 15 minutes, Last 1 hour, etc.)
2. **Service Filter**: Always select `qa-pr-dashboard-api` to see your application traces
3. **Operation Filter**: Use the Operation dropdown to filter by HTTP method (GET, POST, etc.)
4. **Trace Comparison**: Compare multiple search operations to see performance differences
5. **Error Detection**: Look for red spans (errors) in search operations

## Troubleshooting

### No Traces Appearing

1. **Check if tracing is enabled**:
   ```bash
   grep TRACING_ENABLED qa-pr-dashboard/api-server/.env
   ```
   Should be: `TRACING_ENABLED=true`

2. **Check if Jaeger is running**:
   ```bash
   podman ps | grep jaeger
   ```

3. **Check if exporter is set to Jaeger**:
   ```bash
   grep TRACING_EXPORTER qa-pr-dashboard/api-server/.env
   ```
   Should be: `TRACING_EXPORTER=jaeger` or `TRACING_EXPORTER=tempo`

4. **Make a search request** in your application to generate new traces

5. **Check API server logs** for tracing initialization messages

### Traces Not Tagged Correctly

- Ensure the API server has been restarted after the tracing middleware update
- Check that the request path matches the patterns in `detectSearchOperation()`
- Verify that search parameters are being passed in query string or request body

## Advanced: Using Jaeger API

You can also query traces programmatically:

```bash
# Get traces for search operations
curl "http://localhost:16686/api/traces?service=qa-pr-dashboard-api&tags={\"operation.type\":\"search\"}&limit=10"
```

## Related Documentation

- [TRACING_EXPLANATION.md](./TRACING_EXPLANATION.md) - Overview of tracing architecture
- [HOW-TO-VERIFY-TRACING.md](./HOW-TO-VERIFY-TRACING.md) - How to verify tracing is working

