# How to Check Current Run

## 🎯 Quick Answer

The **current/active run** is the run whose data is currently displayed in the Test Cases and Live Progress tabs.

---

## 4 Ways to Check Current Run:

### 1. **🔵 Current Run Indicator Bar** (NEW!)

At the very top of the app panel, you'll see a **purple bar** showing:

```
🔵 Current Run: 1ef5f62c-c1d     [📋 Copy ID]
```

- **Always visible** when a run is active
- Shows the current run ID in monospace font
- **Click "📋 Copy ID"** to copy the run ID to clipboard

**Location**: Right above the tabs (Test Cases | Live Progress | Run History)

---

### 2. **📜 Run History Tab**

Click on the **"📜 Run History"** tab and look for:

✅ **Visual Indicators**:
- **Blue border** around the current run's card
- **"CURRENT" badge** in top-right corner (blue background)

**Example**:
```
┌─────────────────────────────────────┐
│ 1ef5f62c-c1d        [CURRENT] ← Blue badge
│ 2026-01-25 8:06 PM
│ 🌐 https://n1devcmp-user.airteldev.com
│ 📄 10 pages  📝 0 forms  ✅ 26 test cases
│ [📂 Load Run] [✅ View Tests] [📊 Report]
└─────────────────────────────────────┘
     ↑ Blue border (current run)
```

---

### 3. **🌐 Browser URL Bar**

Check the URL in your browser:

```
http://localhost:8000/ui/?run_id=1ef5f62c-c1d
                                 └─────────┘
                                 Current Run ID
```

- The `run_id` parameter shows the active run
- If no `run_id` in URL, it's using localStorage

---

### 4. **💻 Browser Console**

Open DevTools (F12) and run:

```javascript
// Check current run ID
console.log('Current Run:', localStorage.getItem('currentRunId'));

// Output:
// Current Run: 1ef5f62c-c1d
```

---

## 🔄 How Current Run Changes

### When You Start a New Discovery:
1. Click "Start Discovery" button
2. New run ID generated (e.g., `abc123-def`)
3. **Current Run Indicator** updates to show new ID
4. Test Cases and Live Progress reset
5. Run History keeps all old runs

### When You Load a Previous Run:
1. Go to "📜 Run History" tab
2. Click "📂 Load Run" on any past run
3. **Current Run Indicator** updates to that run ID
4. Test Cases and Live Progress show that run's data
5. Blue border moves to the loaded run in history

---

## 📊 What "Current Run" Means

The **current run** determines:

✅ **Test Cases Tab**
- Shows test cases for this run only
- All actions (select, execute) apply to this run

✅ **Live Progress Tab**
- Shows discovery events for this run
- Counters reflect this run's pages/forms/actions

✅ **QA Buddy Panel**
- Free text questions apply to this run
- "View Report" opens this run's report

✅ **Run History Tab**
- Highlights this run with blue border
- Shows "CURRENT" badge

---

## 🎨 Visual Reference

### Current Run Indicator (Top of Page):
```
┌─────────────────────────────────────────────────────────┐
│ 🔵 Current Run: 1ef5f62c-c1d         [📋 Copy ID]      │ ← Purple bar
├─────────────────────────────────────────────────────────┤
│  ✅ Test Cases  │ 📊 Live Progress  │ 📜 Run History   │ ← Tabs
└─────────────────────────────────────────────────────────┘
```

### Run History Tab View:
```
┌─ Run History ──────────────────────────────────────────┐
│                                                         │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ← Blue border
│  ┃ 1ef5f62c-c1d           [CURRENT] ┃
│  ┃ 2026-01-25 8:06 PM                  ┃
│  ┃ 🌐 https://example.com              ┃
│  ┃ 📄 10 pages  ✅ 26 tests            ┃
│  ┃ [📂 Load] [✅ Tests] [📊 Report]    ┃
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
│
│  ┌────────────────────────────────────┐ ← Normal border
│  │ 044ec3a4-51e                       │
│  │ 2026-01-25 7:31 PM                 │
│  │ 🌐 https://example.com             │
│  │ 📄 4 pages  ✅ 10 tests            │
│  │ [📂 Load] [✅ Tests] [📊 Report]   │
│  └────────────────────────────────────┘
│
└─────────────────────────────────────────────────────────┘
```

---

## 💡 Pro Tips

### Copy Run ID Quickly:
1. Look at purple bar at top
2. Click **"📋 Copy ID"** button
3. Run ID copied to clipboard!

### Switch Between Runs Fast:
1. Open **Run History** tab
2. Click **"📂 Load Run"** on any run
3. Watch the purple bar update
4. Switch to **Test Cases** or **Live Progress** to see that run's data

### Verify Active Run:
- Purple bar shows run ID ← **Fastest way**
- URL has `?run_id=xxx`
- Blue border in Run History
- Console: `localStorage.getItem('currentRunId')`

---

## 🚨 Common Questions

### Q: I see multiple runs in history - which one am I viewing?
**A**: Check the **purple bar at top** - that's your active run. Also look for blue border and "CURRENT" badge in Run History.

### Q: How do I switch to a different run?
**A**: Go to Run History tab → Click "📂 Load Run" on the run you want → Purple bar updates.

### Q: Does loading an old run delete it?
**A**: No! Loading a run just switches the view. All runs are preserved.

### Q: Can I have two runs open at once?
**A**: No, only one run is "current" at a time. But you can quickly switch between them in Run History.

### Q: What happens if I start a new discovery?
**A**:
1. New run ID generated
2. Becomes the new "current run"
3. Test Cases and Live Progress reset
4. Old run stays in Run History

---

## ✅ Summary

**Easiest way**: Look at the **🔵 purple bar** at the top showing "Current Run: xxx"

**Most detailed**: Go to **📜 Run History** tab and find the card with:
- Blue border
- "CURRENT" badge

**For developers**: Check browser console:
```javascript
localStorage.getItem('currentRunId')
```

That's it! Now you always know which run you're viewing. 🎉
