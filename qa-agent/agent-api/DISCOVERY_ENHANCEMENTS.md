# Discovery Enhancements - Dynamic UI Support and Live Reporting

## Overview

Enhanced the QA Buddy discovery system to support dynamic UIs (click-based navigation, dropdowns) and provide live reporting to the UI during discovery.

## Key Features Implemented

### 1. Click-Based Navigation Discovery

**Location**: `app/services/discovery_runner.py` - `_discover_sidebar_navigation()`

- **Sidebar Detection**: Detects sidebar/nav containers using multiple selectors:
  - `nav`, `aside`, `[role='navigation']`, `.sidebar`, `.nav-sidebar`, etc.
  
- **Menu Item Enumeration**: Finds visible menu items (both `<a>` and `<button>`)

- **Submenu Exploration**:
  - Clicks each menu item to reveal submenus
  - Waits for UI update (network idle + delay)
  - Re-scans for new submenu items
  - Recursively iterates submenu clicks

- **Fingerprinting**: Uses `(nav_path + current_url + main_heading_text)` to avoid loops

- **Safety**: Skips destructive actions (delete/purge) based on keyword detection

### 2. Top Dropdown Discovery

**Location**: `app/services/discovery_runner.py` - `_discover_top_dropdowns()`

- **Dropdown Detection**: Finds dropdown triggers using:
  - `[role='combobox']`, `[aria-haspopup]`, `.dropdown-toggle`, `select`, etc.

- **Context Selector Identification**: Detects tenant/project/cell selectors by keywords

- **Option Enumeration**:
  - For native `<select>`: Reads all `<option>` elements
  - For custom dropdowns: Clicks to open, enumerates options, then closes

- **No Auto-Switching**: Only reports options, doesn't switch contexts automatically

### 3. Enhanced Page/Form Inspector

**Location**: `app/services/discovery_runner.py` - `_analyze_page_enhanced()`

#### Page Signature
- **Heading**: Extracts main `h1` heading
- **Breadcrumb**: Finds and parses breadcrumb navigation

#### Primary Actions
- **Detection**: Finds Create/Add/Edit/Delete buttons
- **Tagging**: Marks delete actions as "dangerous"
- **Categorization**: Tags actions as "create", "delete", or "other"

#### Forms and Fields
- **Text Inputs**: Captures label, placeholder, required, type
- **Selects/Combobox**: Label, searchable flag, first N options
- **Checkbox/Radio/Switch**: Label + default state (checked/unchecked)
- **Date/Time Inputs**: Label + min/max hints
- **Validation**: Captures pattern attributes

#### Tables
- **Column Headers**: Extracts all column headers from tables

### 4. Live Event Streaming

**Location**: `app/services/discovery_runner.py` - `_emit_event()`, `_get_event_writer()`

- **Event Schema**: JSON Lines format (`events.jsonl`)
  ```json
  {
    "timestamp": "2024-01-01T12:00:00Z",
    "type": "page_discovered",
    "data": { ... }
  }
  ```

- **Event Types**:
  - `discovery_started`: Discovery begins
  - `page_discovered`: New page found (includes URL, title, forms/actions count)
  - `dropdowns_discovered`: Dropdowns found
  - `navigation_discovered`: Navigation items found
  - `discovery_completed`: Discovery finished with summary
  - `discovery_failed`: Discovery error

- **Streaming**: Events written to `artifacts/<run_id>/events.jsonl` in real-time

### 5. Events API Endpoint

**Location**: `app/routers/interactive_qa.py` - `get_events()`

- **Endpoint**: `GET /runs/{run_id}/events?after=<cursor>`
- **Response**:
  ```json
  {
    "run_id": "...",
    "events": [...],
    "next_cursor": 10,
    "total_events": 10
  }
  ```
- **Cursor-Based**: Returns events after specified cursor position for efficient polling

### 6. Discovery App Map

**Location**: `app/services/discovery_runner.py` - `_create_appmap()`

- **Artifact**: `artifacts/<run_id>/discovery_appmap.json`
- **Structure**:
  ```json
  {
    "version": "1.0",
    "generated_at": "...",
    "pages": [...],
    "navigation_tree": {...},
    "context_selectors": [...],
    "forms_summary": {
      "total": 10,
      "by_page": {...}
    }
  }
  ```

### 7. UI Live Reporting

**Location**: `ui/index.html`

#### New UI Sections

1. **Live Discovery Feed** (`#discovery_section`):
   - Real-time stats (pages, forms, actions count)
   - Event log with timestamps and event types
   - Auto-scrolling log

2. **Discovered Pages List** (`#pages_section`):
   - List of all discovered pages
   - Click to view details
   - Shows forms/actions count per page

3. **Page Details Panel** (`#page_details_section`):
   - Page information (title, URL, nav path)
   - Forms and actions summary
   - Field details (when available)

#### JavaScript Features

- **Event Polling**: Polls `/runs/{run_id}/events` every 2 seconds
- **Event Processing**: Parses events and updates UI in real-time
- **Page Selection**: Click pages to view details
- **Auto-Show**: Discovery sections appear when `DISCOVERY_RUN` state is active

## Files Changed

1. **`app/services/discovery_runner.py`**:
   - Complete rewrite with enhanced discovery
   - Added event streaming
   - Added sidebar/submenu discovery
   - Added dropdown discovery
   - Enhanced page analysis
   - Added app map generation

2. **`app/routers/interactive_qa.py`**:
   - Added `GET /runs/{run_id}/events` endpoint

3. **`ui/index.html`**:
   - Added discovery feed UI
   - Added pages list UI
   - Added page details UI
   - Added event polling JavaScript
   - Added CSS for new components

## Event Schema

### Event Structure
```json
{
  "timestamp": "ISO 8601 timestamp",
  "type": "event_type",
  "data": {
    // Event-specific data
  }
}
```

### Event Types

#### `page_discovered`
```json
{
  "url": "https://app.example.com/page",
  "title": "Page Title",
  "nav_path": "Menu > Submenu",
  "forms_count": 2,
  "actions_count": 5
}
```

#### `dropdowns_discovered`
```json
{
  "count": 3,
  "dropdowns": [
    {
      "type": "context_selector",
      "label": "Select Tenant",
      "options_count": 5
    }
  ]
}
```

#### `navigation_discovered`
```json
{
  "count": 15,
  "items": [...]
}
```

#### `discovery_completed`
```json
{
  "pages_count": 25,
  "forms_count": 10,
  "api_endpoints_count": 50,
  "dropdowns_count": 3
}
```

## How Discovery Traverses Sidebar/Submenus

1. **Find Sidebar Containers**: Locates `nav`, `aside`, `[role='navigation']`, etc.

2. **Enumerate Menu Items**: Finds all `<a>` and `<button>` elements in sidebar

3. **Click to Reveal**: For each menu item:
   - If it's a button or has no href, clicks it
   - Waits for UI update (network idle + 0.5s delay)

4. **Scan for Submenus**: After click, looks for:
   - `[aria-expanded]` elements
   - `.submenu`, `.sub-menu`, `.dropdown-menu`
   - `[role='menu']` elements

5. **Recurse Submenus**: For each submenu found:
   - Finds all links/buttons in submenu
   - Adds them to navigation items with `nav_path = "Parent > Child"`
   - Recursively explores nested submenus

6. **Fingerprinting**: Before visiting a page:
   - Creates fingerprint: `md5(nav_path + url + heading)`
   - Skips if fingerprint already visited

7. **Safety Check**: Skips items with destructive keywords (delete, remove, purge, etc.)

## Usage

### Starting Discovery

Discovery automatically starts when:
- User completes login and context selection
- State transitions to `DISCOVERY_RUN`

### Viewing Live Discovery

1. Open UI at `http://localhost:8080/ui/`
2. Start a run
3. When discovery starts, "Live Discovery" section appears
4. Watch real-time events in the discovery feed
5. View discovered pages in the "Discovered Pages" list
6. Click a page to see details

### Polling Events (Programmatic)

```javascript
// Poll events
const response = await fetch(`/runs/${runId}/events?after=${cursor}`);
const data = await response.json();

// Process events
data.events.forEach(event => {
  console.log(event.type, event.data);
});

// Update cursor
cursor = data.next_cursor;
```

## Artifacts Generated

1. **`discovery.json`**: Original discovery results (backward compatible)
2. **`discovery_appmap.json`**: Structured app map with pages, navigation, context selectors
3. **`events.jsonl`**: JSON Lines file with all discovery events

## Backward Compatibility

- All existing `discovery.json` schema fields preserved
- New fields added (not breaking)
- Existing report generation still works
- No changes to existing API contracts (only additions)

## Performance Considerations

- **Fingerprinting**: Prevents infinite loops from dynamic content
- **Limits**: Max 50 pages, 10 cards per page, 20 options per dropdown
- **Network Idle**: Waits for network idle before proceeding
- **Event Buffering**: Events written immediately (no batching needed for small scale)

## Future Enhancements

- [ ] Load full page details from `discovery.json` in UI
- [ ] Show form field details in page details panel
- [ ] Visual navigation tree in UI
- [ ] Export discovery results as OpenAPI spec
- [ ] Support for SPAs with client-side routing
