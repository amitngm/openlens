# QA Buddy - Manual UI Testing Guide

## Purpose
This guide provides step-by-step instructions for manually testing the QA Buddy application UI by:
- Opening each menu item/tab one by one
- Clicking all visible actions
- Verifying forms open and fields/options load correctly
- **Stopping before clicking final Submit/Create/Delete/Confirm buttons**

## Prerequisites
- QA Buddy server running at http://localhost:8000
- Chrome or Firefox browser
- Browser DevTools open (F12) to monitor console errors

---

## Application Overview

**Architecture**: Single-Page Application (SPA)
- **UI File**: `agent-api/ui/index.html` (vanilla HTML/CSS/JavaScript)
- **Layout**: Split-screen (60% app viewer | 40% control panel)
- **Navigation**: 3 tabbed sections
- **Backend API**: FastAPI at http://localhost:8000

**Tab Structure**:
1. **Tab 1 (1️⃣)**: Configuration - Setup and start discovery
2. **Tab 2 (2️⃣)**: Upload Images/Videos (Optional)
3. **Tab 3 (3️⃣)**: Discovery & Results - View findings

---

## Testing Instructions

### Step 1: Initial Load Verification

**Action**: Open http://localhost:8000 in your browser

**Verify**:
- [ ] Page loads without errors
- [ ] Split-screen layout appears (left: app viewer, right: control panel)
- [ ] Configuration tab (Tab 1) is active by default
- [ ] No console errors in DevTools
- [ ] Left panel shows empty iframe area or message
- [ ] Right panel shows "QA Buddy" header and tabs

---

### Step 2: Test Tab 1 - Configuration

**Action**: Click "1️⃣ Configuration" button (should already be active)

#### Form Fields to Test:

**2.1 Base URL Field**
- [ ] Click on the "Base URL" input field
- [ ] Type a test URL: `https://example.com`
- [ ] Verify text appears in the field
- [ ] Verify no validation errors appear
- [ ] Clear the field and verify required field indicator (if any)

**2.2 Environment Dropdown**
- [ ] Click the "Environment" dropdown
- [ ] Verify dropdown menu opens
- [ ] Verify options appear: Development, Staging, Production
- [ ] Click "Development" → verify selection updates
- [ ] Click dropdown again → select "Staging" → verify update
- [ ] Click dropdown again → select "Production" → verify update

**2.3 Headless Mode Checkbox**
- [ ] Verify "Run in headless mode" checkbox is visible
- [ ] Note current state (should be checked by default)
- [ ] Click checkbox → verify it toggles to unchecked
- [ ] Click again → verify it toggles back to checked

**2.4 Discovery Debug Mode Checkbox**
- [ ] Verify "Enable discovery debug mode" checkbox is visible
- [ ] Note current state (should be unchecked by default)
- [ ] Click checkbox → verify it toggles to checked
- [ ] Click again → verify it toggles back to unchecked

**2.5 Authentication Type Dropdown**
- [ ] Click the "Authentication Type" dropdown
- [ ] Verify dropdown opens with options: None, Keycloak
- [ ] Select "Keycloak"
- [ ] **Verify username and password fields appear below**
- [ ] Select "None" again
- [ ] **Verify username and password fields disappear**

**2.6 Username Field (Conditional)**
- [ ] Set Authentication Type to "Keycloak"
- [ ] Verify "Username" field appears
- [ ] Click the username field
- [ ] Type test username: `testuser`
- [ ] Verify text appears in field

**2.7 Password Field (Conditional)**
- [ ] Verify "Password" field appears (when Auth Type = Keycloak)
- [ ] Click the password field
- [ ] Type test password: `testpass123`
- [ ] Verify text appears as masked characters (•••)

#### Action Buttons to Identify (DO NOT CLICK):

**2.8 Start Discovery Button**
- [ ] Locate "🚀 Start Discovery Run" button
- [ ] Verify button is visible and styled (primary blue button)
- [ ] Hover over button → verify hover effect
- [ ] **DO NOT CLICK** (would start actual discovery run)

**Form Validation Test**:
- [ ] Clear the Base URL field
- [ ] Verify Start button state (should be disabled or show validation message)
- [ ] Enter a valid URL → verify button becomes enabled

---

### Step 3: Test Tab 2 - Upload Media

**Action**: Click "2️⃣ Upload Images (Optional)" button

**Verify**:
- [ ] Tab switches from Configuration to Upload Media
- [ ] Tab 2 button shows active styling
- [ ] Tab 1 button shows inactive styling
- [ ] Upload interface appears

#### Image Upload Section:

**3.1 Image Drop Zone**
- [ ] Locate the image drop zone area (dashed border box)
- [ ] Verify text: "Drag & drop images here or click to browse"
- [ ] Verify file type info: "JPG, PNG, GIF, WebP (Max 10MB each)"
- [ ] Hover over drop zone → verify hover effect (background color change)
- [ ] Click the drop zone
- [ ] **Verify file picker dialog opens**
- [ ] Verify file picker shows image filters (*.jpg, *.png, etc.)
- [ ] **Click Cancel** (do not select files)

**3.2 Image File Input**
- [ ] Locate "Choose Files" button or similar
- [ ] Click button
- [ ] Verify file picker opens
- [ ] **Click Cancel** (do not select files)

**3.3 Image Preview Area**
- [ ] Locate image preview section (may be empty)
- [ ] Verify it exists (even if showing "No images selected")

**3.4 Upload Images Button**
- [ ] Locate "📤 Upload Images" button
- [ ] Verify button is visible
- [ ] Hover over button → verify hover effect
- [ ] **DO NOT CLICK** (would attempt to upload files)

#### Video Upload Section:

**3.5 Video Drop Zone**
- [ ] Locate the video drop zone area (below image section)
- [ ] Verify text: "Drag & drop videos here or click to browse"
- [ ] Verify file type info: "MP4, WebM, MOV (Max 100MB each)"
- [ ] Hover over drop zone → verify hover effect
- [ ] Click the drop zone
- [ ] **Verify file picker dialog opens**
- [ ] Verify file picker shows video filters (*.mp4, *.webm, etc.)
- [ ] **Click Cancel** (do not select files)

**3.6 Video File Input**
- [ ] Click video browse button
- [ ] Verify file picker opens
- [ ] **Click Cancel**

**3.7 Video Preview Area**
- [ ] Locate video preview section
- [ ] Verify it exists (may be empty)

**3.8 Upload Videos Button**
- [ ] Locate "📤 Upload Videos" button
- [ ] Verify button is visible
- [ ] **DO NOT CLICK**

#### Uploaded Images List:

**3.9 Previously Uploaded Images**
- [ ] Scroll down to "Uploaded Images" section
- [ ] Verify section exists
- [ ] Check if any images are listed (from previous runs)
- [ ] If images exist, verify each shows:
  - Thumbnail or filename
  - Analysis results (element count, components, workflows)
  - Remove button (if applicable)

---

### Step 4: Test Tab 3 - Discovery & Results

**Action**: Click "3️⃣ Discovery & Results" button

**Verify**:
- [ ] Tab switches to Discovery & Results
- [ ] Tab 3 button shows active styling
- [ ] Discovery interface appears

#### Live Discovery Card:

**4.1 Stats Section**
- [ ] Locate "Live Discovery" card at top
- [ ] Verify stats grid is visible with three counters:
  - [ ] "Pages discovered" (shows count, initially 0)
  - [ ] "Forms discovered" (shows count, initially 0)
  - [ ] "Actions discovered" (shows count, initially 0)
- [ ] Verify each stat has appropriate icon
- [ ] Verify counts are displayed in large font

**4.2 Discovery Feed**
- [ ] Locate "Discovery Feed" section (scrollable log area)
- [ ] Verify it exists (may be empty with message "No events yet")
- [ ] Check if scrollbar appears (if there are previous events)
- [ ] Verify feed area has max-height and scrolls

#### Discovered Pages Card:

**4.3 Pages List**
- [ ] Locate "Discovered Pages" card
- [ ] Verify card is visible
- [ ] If empty, verify message: "No pages discovered yet"
- [ ] If pages exist from previous run:
  - [ ] Verify page items are listed
  - [ ] Each page shows: URL, form count, action count
  - [ ] Hover over a page → verify hover effect
  - [ ] Click a page item
  - [ ] Verify Page Details card updates (see 4.4)

#### Page Details Card:

**4.4 Page Details Display**
- [ ] Locate "Page Details" card
- [ ] Initially may be hidden or show "Select a page to view details"
- [ ] If you clicked a page in 4.3:
  - [ ] Verify page name appears
  - [ ] Verify URL is displayed
  - [ ] Verify form count is shown
  - [ ] Verify action count is shown
  - [ ] Verify any additional metadata displays

#### Discovered Test Cases Card:

**4.5 Features and Test Cases**
- [ ] Locate "Discovered Test Cases" card
- [ ] Verify card is visible
- [ ] If empty, verify message: "No test cases generated yet"
- [ ] If test cases exist from previous run:
  - [ ] Verify features are grouped in sections
  - [ ] Each feature shows count of test cases
  - [ ] Click a feature section header to expand
  - [ ] **Verify test cases expand/appear**
  - [ ] Click another feature section
  - [ ] **Verify first section collapses** (accordion behavior)
  - [ ] Verify each test case shows:
    - Test ID
    - Test name
    - Priority badge (high/normal)
    - Test steps list

**4.6 Test Case Details**
- [ ] Expand a test case (if available)
- [ ] Verify steps are displayed as numbered list
- [ ] Verify each step shows clear action description
- [ ] Verify test type is indicated (navigation, CRUD, etc.)

#### Report Card:

**4.7 Full Report Button**
- [ ] Look for "Report" card (may be hidden initially)
- [ ] If visible (after a completed run):
  - [ ] Locate "📄 Open Full Report" button
  - [ ] Verify button is enabled
  - [ ] Hover over button → verify hover effect
  - [ ] **DO NOT CLICK** (would open report in new tab)

---

### Step 5: Test Left Panel - App Viewer

**Action**: Look at the left side of split-screen

**5.1 App Iframe Container**
- [ ] Locate the left panel (60% width)
- [ ] Verify iframe container exists
- [ ] If no URL loaded:
  - [ ] Verify message: "No application loaded" or similar
  - [ ] Or verify iframe shows blocked message
- [ ] If URL loaded from previous run:
  - [ ] Verify application appears in iframe
  - [ ] Or verify "X-Frame-Options blocked" message

**5.2 App Panel Header**
- [ ] Locate header bar above iframe (if present)
- [ ] Verify current URL is displayed
- [ ] Locate "Open in New Tab" button
- [ ] Hover over button → verify hover effect
- [ ] **DO NOT CLICK** (would open new browser tab)

**5.3 App Panel Responsiveness**
- [ ] Verify iframe fills the left panel area
- [ ] Verify no overflow or scrollbar issues on panel itself

---

### Step 6: Test Tab Navigation & State Persistence

**6.1 Tab Switching**
- [ ] Click Tab 1 (Configuration)
- [ ] Verify tab activates and content shows
- [ ] Click Tab 2 (Upload Media)
- [ ] Verify tab switches correctly
- [ ] Click Tab 3 (Discovery & Results)
- [ ] Verify tab switches correctly
- [ ] Return to Tab 1
- [ ] **Verify form values are still present** (state persisted)
- [ ] Check that Base URL you typed earlier is still there
- [ ] Verify Environment selection is still correct

**6.2 Active Tab Styling**
- [ ] Click each tab in sequence
- [ ] Verify active tab has highlighted styling (different background/border)
- [ ] Verify inactive tabs have muted styling
- [ ] Verify smooth transition between tabs

---

### Step 7: Test Responsive Layout

**7.1 Browser Window Resize**
- [ ] Resize browser to full screen
- [ ] Verify split-screen layout maintains 60/40 ratio
- [ ] Resize browser to narrow width (1024px)
- [ ] Verify layout still readable
- [ ] Verify no horizontal scrollbar appears
- [ ] Verify form fields don't overflow
- [ ] Resize browser to very wide (1920px+)
- [ ] Verify layout scales appropriately

**7.2 Zoom Testing**
- [ ] Set browser zoom to 150% (Ctrl/Cmd +)
- [ ] Verify text remains readable
- [ ] Verify buttons don't overlap
- [ ] Reset zoom to 100% (Ctrl/Cmd 0)

---

### Step 8: Console & Network Verification

**8.1 Browser Console Check**
- [ ] Open DevTools (F12)
- [ ] Click Console tab
- [ ] Verify no red error messages
- [ ] Verify no 404 errors for resources
- [ ] Check for any warnings (yellow) - note them down

**8.2 Network Tab Check**
- [ ] Click Network tab in DevTools
- [ ] Refresh page (F5)
- [ ] Verify all resources load successfully (200 OK):
  - [ ] index.html
  - [ ] Any CSS files
  - [ ] Any JavaScript files
  - [ ] Any image/icon files
- [ ] Verify no failed requests (red indicators)

**8.3 Performance Check**
- [ ] Note page load time
- [ ] Verify UI is responsive to clicks (no lag)
- [ ] Verify tab switching is instant
- [ ] Verify form field typing has no delay

---

## Dynamic Elements Testing (If Discovery Was Previously Run)

These tests only apply if you have completed discovery runs in the system.

### 9.1 Status Card (During Active Run)
- [ ] If a run is active, locate Status Card at top of Tab 1
- [ ] Verify it shows:
  - Run status badge (running/completed/failed)
  - Current state (e.g., "DISCOVERY_RUN")
  - Current URL being tested
  - Progress bar (if applicable)
- [ ] Verify status updates automatically (polls every 2 seconds)

### 9.2 Stop Button (During Active Run)
- [ ] If run is active, locate "⏹️ Stop Polling" button
- [ ] Verify button appears in danger style (red)
- [ ] Hover over button
- [ ] **DO NOT CLICK** (would stop the active run)

### 9.3 Question Card (Interactive Prompts)
- [ ] If question appears during run, locate Question Card
- [ ] Verify question text is displayed
- [ ] Verify option buttons are visible
- [ ] Hover over option buttons
- [ ] **DO NOT CLICK** (would submit answer)

### 9.4 Free Text Card
- [ ] Locate "Ask QA Buddy" section (if visible during run)
- [ ] Click the textarea
- [ ] Type test question: "What is being tested?"
- [ ] Verify text appears in textarea
- [ ] Locate "Send" button next to textarea
- [ ] **DO NOT CLICK** (would submit question)

### 9.5 Discovery Event Stream
- [ ] If discovery is running, watch Discovery Feed on Tab 3
- [ ] Verify events appear in real-time
- [ ] Verify each event shows:
  - Timestamp
  - Event type (e.g., "page_discovered")
  - Event details
- [ ] Verify feed auto-scrolls to show latest events

---

## Summary Checklist

### Must Verify ✓
- [ ] All 3 tabs are accessible and switch correctly
- [ ] All form fields accept input (text, dropdown, checkbox)
- [ ] File upload zones open file pickers
- [ ] Conditional fields show/hide correctly (auth fields)
- [ ] No console errors in browser DevTools
- [ ] No broken network requests (404, 500 errors)
- [ ] Layout is responsive at different window sizes
- [ ] Form values persist when switching tabs
- [ ] All buttons are visible and have hover effects

### Must NOT Do ✗
- [ ] ❌ Click "🚀 Start Discovery Run" button (starts actual test run)
- [ ] ❌ Click "📤 Upload Images" or "📤 Upload Videos" buttons (submits files)
- [ ] ❌ Click "⏹️ Stop Polling" button (stops active run)
- [ ] ❌ Click "📄 Open Full Report" button (opens new tab)
- [ ] ❌ Click "Open in New Tab" button (opens new window)
- [ ] ❌ Submit any answers to interactive questions (submits to backend)
- [ ] ❌ Click any "Confirm", "Submit", "Delete", or "Create" buttons

---

## Bug Reporting Template

If you find any issues during testing, document them using this format:

**Issue #**: [Sequential number]
**Severity**: Critical / High / Medium / Low
**Location**: [Tab name / Element ID]
**Steps to Reproduce**:
1. Step 1
2. Step 2
3. ...

**Expected Behavior**: [What should happen]
**Actual Behavior**: [What actually happened]
**Console Errors**: [Any errors from DevTools]
**Screenshot**: [Attach if relevant]

---

## Notes

- This UI is a **single-file application** (`ui/index.html`) with embedded CSS and JavaScript
- No build process required - direct HTML served by FastAPI
- Status updates poll the backend every 2 seconds during active runs
- The application stores run data in SQLite database (`qa_buddy.db`)
- Full report is generated as HTML after discovery completes

---

## Additional Optional Tests

### Accessibility Testing
- [ ] Tab through all form fields using keyboard only
- [ ] Verify focus indicators are visible
- [ ] Verify all buttons are keyboard accessible
- [ ] Test with screen reader (if available)

### Browser Compatibility
- [ ] Test in Chrome
- [ ] Test in Firefox
- [ ] Test in Safari (if on Mac)
- [ ] Test in Edge

### Dark Mode (if supported)
- [ ] Check if OS dark mode affects UI
- [ ] Verify all text remains readable
- [ ] Verify contrast is adequate

---

## Completion

After completing all tests:
1. [ ] Document all issues found
2. [ ] Capture screenshots of each tab
3. [ ] Note any suggestions for improvement
4. [ ] Verify overall user experience is smooth
5. [ ] Confirm no blocking issues prevent usage

**Testing Status**: ⬜ Not Started | 🟡 In Progress | ✅ Complete

**Tested By**: _________________
**Date**: _________________
**Browser**: _________________
**OS**: _________________

---

## Quick Reference - Element IDs

**Tab 1 - Configuration**:
- `#base_url` - Base URL input
- `#env` - Environment dropdown
- `#headless` - Headless mode checkbox
- `#discovery_debug` - Debug mode checkbox
- `#auth_type` - Authentication type dropdown
- `#username` - Username input (conditional)
- `#password` - Password input (conditional)
- `#start_btn` - Start discovery button
- `#stop_btn` - Stop polling button (during run)

**Tab 2 - Upload**:
- `#image_upload_area` - Image drop zone
- `#image_input` - Image file input
- `#image_preview` - Image preview area
- `#upload_images_btn` - Upload images button
- `#video_upload_area` - Video drop zone
- `#video_input` - Video file input
- `#video_preview` - Video preview area
- `#upload_videos_btn` - Upload videos button
- `#uploaded_images_list` - List of uploaded images

**Tab 3 - Discovery**:
- `#discovery_pages_count` - Pages counter
- `#discovery_forms_count` - Forms counter
- `#discovery_actions_count` - Actions counter
- `#discovery_feed` - Event stream
- `#pages_card` - Discovered pages list
- `#page_details_card` - Selected page details
- `#features_card` - Test cases grouped by feature
- `#report_card` - Report section

**Other**:
- `#app_iframe` - Application viewer iframe
- `#status_card` - Run status card
- `#question_card` - Interactive question prompts
- `#free_text_card` - Ask QA Buddy section

---

**End of Manual UI Testing Guide**

For automated testing or additional questions, refer to:
- `DATABASE_README.md` - Database structure and API
- `DEPLOYMENT_GUIDE.md` - Deployment options
- `START_QA_BUDDY.md` - Quick start guide
