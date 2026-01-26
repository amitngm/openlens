# 📎 How to Upload Files - Visual Guide

## Step-by-Step Instructions

### Step 1: Open the UI
```bash
http://localhost:8000/ui/
```

### Step 2: Go to Configuration Tab
Look at the **right panel** (QA Buddy panel) → **⚙️ Configuration** tab

### Step 3: Find the Upload Section
Scroll down past the authentication fields until you see:

```
┌─────────────────────────────────────────────────┐
│ Username                                         │
│ [testapi                                    ]   │
│ Password                                         │
│ [••••••••••                                 ]   │
└─────────────────────────────────────────────────┘

▶ 📎 Upload Requirements (PRD, Images, Documents)  ← CLICK THIS!

▶ ⚙️ Advanced Settings
```

### Step 4: Click to Expand
Click the **"📎 Upload Requirements"** line to expand it.

### Step 5: You'll See File Upload Inputs

After expanding, you'll see:

```
▼ 📎 Upload Requirements (PRD, Images, Documents)
┌─────────────────────────────────────────────────────────┐
│ Upload PRD documents, mockups, screenshots, or          │
│ requirement files to help QA Buddy understand expected  │
│ behavior and generate better test cases.                │
│                                                          │
│ 📄 PRD / Requirement Documents (PDF, DOCX, TXT, MD)     │
│ ┌─────────────────────────────────────────────────────┐│
│ │ Choose Files                                  No... ││ ← CLICK HERE
│ └─────────────────────────────────────────────────────┘│
│ 👆 Click to select files or drag & drop here           │
│                                                          │
│ 🖼️ Mockups / Screenshots (PNG, JPG, JPEG)              │
│ ┌─────────────────────────────────────────────────────┐│
│ │ Choose Files                                  No... ││ ← CLICK HERE
│ └─────────────────────────────────────────────────────┘│
│ 👆 Click to select images or drag & drop here          │
│                                                          │
│ 🎨 Figma / Design Links (Optional)                      │
│ [https://figma.com/...                            ]     │
│                                                          │
│ 📝 Expected Behavior / Notes (Optional)                 │
│ ┌─────────────────────────────────────────────────────┐│
│ │ Describe expected behavior...                       ││
│ │                                                      ││
│ │                                                      ││
│ └─────────────────────────────────────────────────────┘│
│                                                          │
│ [🗑️ Clear All Uploads]                                  │
└─────────────────────────────────────────────────────────┘
```

---

## How to Upload PRD Documents

### 1. Click the Documents File Input
Click on the **"Choose Files"** button under "📄 PRD / Requirement Documents"

### 2. Select Your Files
A file picker dialog will open. Navigate to your files and select:
- Single file: Click once on a file
- Multiple files: Hold **Ctrl** (Windows) or **Cmd** (Mac) and click multiple files

**Supported formats:**
- ✅ PDF files (.pdf)
- ✅ Word documents (.docx, .doc)
- ✅ Text files (.txt)
- ✅ Markdown files (.md)

### 3. See Confirmation
After selection, you'll see:
```
📄 3 file(s) selected:
• requirements.pdf (245.3 KB)
• user-stories.docx (128.7 KB)
• api-spec.md (45.2 KB)
```

---

## How to Upload Images/Mockups

### 1. Click the Images File Input
Click on the **"Choose Files"** button under "🖼️ Mockups / Screenshots"

### 2. Select Your Images
A file picker dialog will open. Select your images:

**Supported formats:**
- ✅ PNG images (.png)
- ✅ JPEG images (.jpg, .jpeg)

### 3. See Confirmation
After selection, you'll see:
```
🖼️ 2 image(s) selected:
• homepage-mockup.png (567.8 KB)
• dashboard-design.jpg (432.1 KB)
```

---

## Complete Example

### Scenario: Upload Everything

**1. Expand Upload Section**
Click "📎 Upload Requirements" to expand

**2. Upload Documents**
- Click "Choose Files" under PRD section
- Select: `requirements.pdf`, `test-plan.docx`
- See: "📄 2 file(s) selected..."

**3. Upload Images**
- Click "Choose Files" under Images section
- Select: `mockup-v3.png`, `expected-ui.jpg`
- See: "🖼️ 2 image(s) selected..."

**4. Add Figma Link**
Paste: `https://figma.com/file/abc123/dashboard-v2`

**5. Add Notes**
Type in the Expected Behavior textarea:
```
Critical features to test:
- Pagination must support infinite scroll
- Search should filter in real-time
- Forms must validate before submission

Known issues:
- Search is slow with 1000+ items
- Mobile pagination needs work
```

**6. Start Discovery**
Scroll down and click **"🚀 Start Discovery Run"**

**7. Watch Upload Progress**
You'll see messages:
```
📎 Uploading requirement files...
✅ Uploaded 2 document(s)
✅ Uploaded 2 image(s)
✅ Metadata updated
🚀 Run started: abc123
```

---

## Troubleshooting

### Can't See the Upload Section?

**Problem:** Don't see "📎 Upload Requirements"

**Solution:**
1. Make sure you're on the **Configuration** tab (right panel)
2. Scroll down past the authentication fields
3. Look for the collapsed section with arrow: **▶ 📎 Upload Requirements**
4. Click on it to expand: **▼ 📎 Upload Requirements**

### File Input Buttons Not Visible?

**Problem:** Expanded section but no file inputs

**Solution:**
1. Refresh the page (Ctrl+R or Cmd+R)
2. Make sure you clicked the **"📎 Upload Requirements"** line
3. Look for the dashed border boxes labeled "Choose Files"

### Wrong File Format Error?

**Problem:** File doesn't upload

**Solution:**
- **Documents:** Only PDF, DOCX, DOC, TXT, MD
- **Images:** Only PNG, JPG, JPEG
- Check file extension matches supported formats

### Nothing Happens After Selecting Files?

**Problem:** Selected files but no confirmation

**Solution:**
1. Check browser console (F12) for errors
2. Make sure JavaScript is enabled
3. Try refreshing the page
4. Look for the file list that should appear below the input

---

## What Happens After Upload

### During Discovery Start:

```
User clicks "Start Discovery"
         ↓
System creates run (run_id: abc123)
         ↓
System detects uploaded files
         ↓
Message: "📎 Uploading requirement files..."
         ↓
Upload PRD documents → POST /runs/abc123/upload/documents
         ↓
Message: "✅ Uploaded 2 document(s)"
         ↓
Upload images → POST /runs/abc123/upload/images
         ↓
Message: "✅ Uploaded 2 image(s)"
         ↓
Send metadata → POST /runs/abc123/metadata
         ↓
Discovery begins with uploaded context
```

### Files Stored In:

```
data/abc123/
  ├── uploads/
  │   ├── documents/
  │   │   ├── requirements.pdf
  │   │   └── test-plan.docx
  │   └── images/
  │       ├── mockup-v3.png
  │       └── expected-ui.jpg
  └── requirement_metadata.json
```

---

## Quick Reference

### Upload Documents:
1. Expand "📎 Upload Requirements"
2. Click "Choose Files" under "📄 PRD / Requirement Documents"
3. Select .pdf, .docx, .doc, .txt, or .md files
4. See file list confirmation

### Upload Images:
1. Expand "📎 Upload Requirements"
2. Click "Choose Files" under "🖼️ Mockups / Screenshots"
3. Select .png, .jpg, or .jpeg files
4. See image list confirmation

### Add Links:
1. Paste Figma/design URL in the "🎨 Figma / Design Links" field
2. Add more links in textarea (one per line)

### Add Notes:
1. Type in "📝 Expected Behavior / Notes" textarea
2. Describe requirements, flows, critical features

### Clear All:
1. Click "🗑️ Clear All Uploads" button
2. All selections cleared

### Upload to Server:
1. Click "🚀 Start Discovery Run"
2. Files automatically upload
3. Watch for success messages

---

## Visual Indicators

### Before Selecting Files:
```
┌─────────────────────────────────────────────────┐
│ Choose Files                          No file... │
└─────────────────────────────────────────────────┘
👆 Click to select files or drag & drop here
```

### After Selecting Files:
```
┌─────────────────────────────────────────────────┐
│ Choose Files                          3 files    │
└─────────────────────────────────────────────────┘
👆 Click to select files or drag & drop here

📄 3 file(s) selected:
• requirements.pdf (245.3 KB)
• user-stories.docx (128.7 KB)
• api-spec.md (45.2 KB)
```

---

## Testing It Works

### Quick Test:

1. **Expand section** → Click "📎 Upload Requirements"
2. **Select a test file** → Click "Choose Files" under Documents
3. **Check confirmation** → Should see "📄 1 file(s) selected: yourfile.pdf"
4. **Start discovery** → Click "🚀 Start Discovery Run"
5. **Watch messages** → See "📎 Uploading..." then "✅ Uploaded 1 document(s)"
6. **Verify storage** → Check `data/<run_id>/uploads/documents/yourfile.pdf` exists

---

## Ready to Upload!

The file upload feature is **fully functional**. Just:

1. ✅ **Expand** the "📎 Upload Requirements" section
2. ✅ **Click** the "Choose Files" buttons
3. ✅ **Select** your documents and images
4. ✅ **Start** discovery to automatically upload

**That's it!** 🚀
