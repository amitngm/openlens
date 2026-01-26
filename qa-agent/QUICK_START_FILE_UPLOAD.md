# 🚀 Quick Start: File Upload Feature

## Where to Find It

### Step 1: Open QA Buddy UI

```bash
# Start the server
cd /Users/amitkumarnigam/Downloads/openlens/qa-agent/agent-api
uvicorn app.main:app --reload

# Open in browser
http://localhost:8000/ui/
```

### Step 2: Find the Upload Section

Look for this in the **Configuration Tab** (right panel):

```
┌─────────────────────────────────────────────────────┐
│ ⚙️ Configuration                 📊 Results          │
├─────────────────────────────────────────────────────┤
│                                                      │
│ Base URL *                                           │
│ https://your-app.example.com                        │
│                                                      │
│ Environment                                          │
│ [Staging ▼]                                         │
│                                                      │
│ ☑ Run in headless mode                              │
│                                                      │
│ Authentication Type                                  │
│ [Keycloak ▼]                                        │
│                                                      │
│ Username: testapi                                    │
│ Password: ••••••••••                                │
│                                                      │
│ ▶ 📎 Upload Requirements (PRD, Images, Documents) ◀ │ ← CLICK HERE!
│                                                      │
│ ▶ ⚙️ Advanced Settings                              │
│                                                      │
│ [🚀 Start Discovery Run]                            │
└─────────────────────────────────────────────────────┘
```

### Step 3: Expand Upload Section

Click on **"📎 Upload Requirements (PRD, Images, Documents)"** to expand it.

You'll see:

```
📎 Upload Requirements (PRD, Images, Documents)  [EXPANDED]
│
├─ Upload PRD documents, mockups, screenshots, or requirement
│  files to help QA Buddy understand expected behavior and
│  generate better test cases.
│
├─ 📄 PRD / Requirement Documents (PDF, DOCX, TXT, MD)
│  [Choose Files] ← Click to upload documents
│
├─ 🖼️ Mockups / Screenshots (PNG, JPG, JPEG)
│  [Choose Files] ← Click to upload images
│
├─ 🎨 Figma / Design Links (Optional)
│  https://figma.com/... ← Paste Figma link
│  [Additional links textarea] ← More links
│
├─ 📝 Expected Behavior / Notes (Optional)
│  [Large text area] ← Describe expectations
│
└─ [🗑️ Clear All Uploads] ← Reset everything
```

---

## What You Can Upload

### 📄 Documents
- **Formats:** PDF, DOCX, DOC, TXT, MD
- **Examples:**
  - requirements.pdf
  - user-stories.docx
  - api-spec.md
  - test-plan.txt

### 🖼️ Images
- **Formats:** PNG, JPG, JPEG
- **Examples:**
  - homepage-mockup.png
  - dashboard-screenshot.jpg
  - expected-ui.png

### 🎨 Design Links
- Figma URLs
- Sketch URLs
- Adobe XD links
- Any design tool URL

### 📝 Notes
- Expected behavior
- User flows
- Critical features
- Known issues
- Special requirements

---

## How to Use

### Example 1: Upload PRD Document

1. Click "📎 Upload Requirements" to expand
2. Click **"Choose Files"** under "📄 PRD / Requirement Documents"
3. Select your `requirements.pdf`
4. You'll see: **"📄 1 file(s) selected: requirements.pdf (245.3 KB)"**
5. Fill in base URL and credentials
6. Click **"🚀 Start Discovery Run"**
7. System will show: **"📎 Uploading requirement files..."**
8. Success: **"✅ Uploaded 1 document(s)"**

### Example 2: Upload Mockup Images

1. Click **"Choose Files"** under "🖼️ Mockups / Screenshots"
2. Select multiple images (Ctrl/Cmd + Click)
   - homepage.png
   - dashboard.png
   - forms.png
3. You'll see: **"🖼️ 3 image(s) selected:"**
   - homepage.png (567.8 KB)
   - dashboard.png (432.1 KB)
   - forms.png (289.5 KB)
4. Start discovery
5. Success: **"✅ Uploaded 3 image(s)"**

### Example 3: Add Figma Link + Notes

1. Paste Figma link: `https://figma.com/file/abc123/dashboard-v2`
2. Add notes in text area:
   ```
   Must test:
   - Pagination with 100+ items
   - Search should filter in real-time
   - Forms must validate before submit
   - Dark mode support required
   ```
3. Start discovery
4. Metadata saved automatically

### Example 4: Complete Upload

Upload everything at once:

1. **📄 Documents:**
   - requirements.pdf
   - user-stories.docx
   - api-spec.md

2. **🖼️ Images:**
   - homepage-mockup.png
   - dashboard-design.jpg

3. **🎨 Design Link:**
   - https://figma.com/file/xyz/app-v2

4. **📝 Notes:**
   ```
   Critical flows:
   1. User registration → email verification
   2. Login → dashboard → profile
   3. Create item → review → submit

   Known issues:
   - Search is slow with 1000+ items
   - Pagination breaks on mobile
   ```

5. Click **"Start Discovery"**

6. Watch uploads:
   ```
   📎 Uploading requirement files...
   ✅ Uploaded 3 document(s)
   ✅ Uploaded 2 image(s)
   ✅ Metadata updated
   ```

---

## Where Files Are Stored

After upload, files are saved in:

```
data/
  <run_id>/
    uploads/
      documents/
        requirements.pdf
        user-stories.docx
        api-spec.md
      images/
        homepage-mockup.png
        dashboard-design.jpg
    requirement_metadata.json
```

---

## Clear Uploads

To reset everything:

1. Click **"🗑️ Clear All Uploads"** button
2. All files cleared
3. All inputs reset
4. Message: **"✅ Uploads cleared"**

---

## Verify It's Working

### Visual Check:

1. **Open UI:** http://localhost:8000/ui/
2. **Look for:** "📎 Upload Requirements" in Configuration panel
3. **Expand it:** Click to reveal upload options
4. **You should see:**
   - File input for documents
   - File input for images
   - Figma link field
   - Notes textarea
   - Clear button

### Upload Test:

1. Select a test PDF file
2. Watch file list appear with size
3. Start discovery
4. Check console for upload messages
5. Verify files in `data/<run_id>/uploads/`

---

## Troubleshooting

### Can't Find Upload Section?

- Make sure you're on **Configuration tab** (right panel)
- Look for the collapsible section **"📎 Upload Requirements"**
- It's between "Authentication Type" and "Advanced Settings"

### Files Not Uploading?

- Check file format (.pdf, .docx, .png, .jpg only)
- Start discovery first (run must exist)
- Check browser console for errors
- Verify server is running

### No Success Messages?

- Open browser DevTools (F12)
- Check Network tab for API calls
- Look for `/upload/documents` and `/upload/images` requests
- Check for 200 OK responses

---

## Screenshot Guide

**Location in UI:**

```
Right Panel (QA Buddy)
  ├─ 🤖 QA Buddy Header
  │
  ├─ Tabs: [⚙️ Configuration] [📊 Results]
  │
  └─ Configuration Tab Content:
      │
      ├─ Base URL input
      ├─ Environment dropdown
      ├─ Headless checkbox
      ├─ Auth Type dropdown
      ├─ Username/Password inputs
      │
      ├─ ▼ 📎 Upload Requirements ← HERE!
      │   ├─ 📄 PRD Documents upload
      │   ├─ 🖼️ Images upload
      │   ├─ 🎨 Design links
      │   ├─ 📝 Notes textarea
      │   └─ 🗑️ Clear button
      │
      ├─ ▶ ⚙️ Advanced Settings
      │
      └─ [🚀 Start Discovery Run] button
```

---

## Next Steps

1. ✅ **Open UI** - http://localhost:8000/ui/
2. ✅ **Find section** - "📎 Upload Requirements"
3. ✅ **Upload files** - Documents, images, links
4. ✅ **Start discovery** - Files upload automatically
5. ✅ **Check storage** - Verify files in data/<run_id>/uploads/

**The feature is ready to use!** 🚀

---

## Need Help?

- **File formats supported?** PDF, DOCX, DOC, TXT, MD, PNG, JPG, JPEG
- **How many files?** Multiple files supported
- **File size limit?** No hard limit (reasonable sizes recommended)
- **When to upload?** Before starting discovery
- **Where are files?** `data/<run_id>/uploads/documents/` and `/images/`

**Ready to upload your requirements!** 📎
