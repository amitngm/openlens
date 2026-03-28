package report

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
)

// Generator creates HTML reports
type Generator struct {
	artDir string
}

// NewGenerator creates a new Generator
func NewGenerator(artDir string) *Generator {
	return &Generator{artDir: artDir}
}

// Generate creates an HTML report and returns the file path
func (g *Generator) Generate(rc *models.RunContext, suite *models.TestSuite, disc *store.DiscoveryResult) (string, error) {
	runDir := filepath.Join(g.artDir, rc.RunID)
	if err := os.MkdirAll(runDir, 0755); err != nil {
		return "", err
	}
	reportPath := filepath.Join(runDir, "report.html")

	html := g.buildHTML(rc, suite, disc)
	if err := os.WriteFile(reportPath, []byte(html), 0644); err != nil {
		return "", err
	}
	return reportPath, nil
}

func (g *Generator) buildHTML(rc *models.RunContext, suite *models.TestSuite, disc *store.DiscoveryResult) string {
	passRate := 0.0
	if suite.Total > 0 {
		passRate = float64(suite.Passed) / float64(suite.Total) * 100
	}

	modules := []string{}
	pages := 0
	if disc != nil {
		modules = disc.Modules
		pages = len(disc.Pages)
	}

	// Build test rows
	var testRows strings.Builder
	for _, tc := range suite.TestCases {
		statusClass := "status-passed"
		statusIcon := "✅"
		if tc.Status == models.TestStatusFailed {
			statusClass = "status-failed"
			statusIcon = "❌"
		} else if tc.Status == models.TestStatusSkipped {
			statusClass = "status-skipped"
			statusIcon = "⏭️"
		}
		severityClass := "sev-" + string(tc.Severity)

		errorRow := ""
		if tc.ErrorMessage != "" {
			errorRow = fmt.Sprintf(`<tr class="error-row"><td colspan="6"><code>%s</code></td></tr>`, escapeHTML(tc.ErrorMessage))
		}

		testRows.WriteString(fmt.Sprintf(`
		<tr class="%s">
			<td>%s</td>
			<td class="test-name">%s</td>
			<td><span class="severity %s">%s</span></td>
			<td>%s</td>
			<td>%dms</td>
			<td><span class="feature-badge">%s</span></td>
		</tr>%s`,
			statusClass, statusIcon,
			escapeHTML(tc.Name),
			severityClass, string(tc.Severity),
			string(tc.Category),
			tc.ExecutionTimeMs,
			string(tc.FeatureType),
			errorRow,
		))
	}

	// Build modules list
	var modsList strings.Builder
	for _, m := range modules {
		modsList.WriteString(fmt.Sprintf(`<span class="module-chip">%s</span>`, escapeHTML(m)))
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QA Buddy Report — %s</title>
<style>
  :root {
    --indigo: #6366f1; --green: #22c55e; --red: #ef4444; --yellow: #f59e0b;
    --gray: #6b7280; --dark: #1e1b4b; --light: #f8fafc;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: var(--light); color: #1e293b; }
  .header { background: var(--dark); color: white; padding: 24px 32px; }
  .header h1 { font-size: 24px; font-weight: 700; }
  .header .meta { font-size: 13px; opacity: 0.7; margin-top: 4px; }
  .content { max-width: 1200px; margin: 0 auto; padding: 32px; }
  .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 32px; }
  .summary-card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .summary-card .num { font-size: 36px; font-weight: 700; }
  .summary-card .label { font-size: 13px; color: var(--gray); margin-top: 4px; }
  .summary-card.passed .num { color: var(--green); }
  .summary-card.failed .num { color: var(--red); }
  .summary-card.coverage .num { color: var(--indigo); }
  .section { background: white; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .section h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: var(--dark); border-bottom: 2px solid var(--indigo); padding-bottom: 8px; }
  table { width: 100%%; border-collapse: collapse; font-size: 14px; }
  th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-weight: 600; color: var(--gray); }
  td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
  tr.status-failed { background: #fef2f2; }
  tr.status-skipped { background: #fefce8; }
  .error-row td { padding: 6px 12px 12px; }
  .error-row code { background: #fee2e2; color: #b91c1c; padding: 6px 10px; border-radius: 6px; font-size: 12px; display: block; }
  .severity { padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .sev-critical { background: #fee2e2; color: #b91c1c; }
  .sev-high { background: #fff7ed; color: #c2410c; }
  .sev-medium { background: #fefce8; color: #854d0e; }
  .sev-low { background: #f0fdf4; color: #166534; }
  .feature-badge { background: #ede9fe; color: #5b21b6; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
  .test-name { font-weight: 500; }
  .progress-bar { height: 10px; background: #e2e8f0; border-radius: 99px; overflow: hidden; margin: 6px 0; }
  .progress-fill { height: 100%%; background: var(--indigo); border-radius: 99px; transition: width 0.3s; }
  .progress-fill.green { background: var(--green); }
  .module-chip { display: inline-block; background: #ede9fe; color: #5b21b6; padding: 4px 12px; border-radius: 99px; font-size: 12px; margin: 4px 4px 4px 0; font-weight: 500; }
  .disc-stat { display: inline-flex; align-items: center; gap: 8px; background: #f8fafc; border-radius: 8px; padding: 10px 16px; margin-right: 12px; margin-bottom: 12px; font-weight: 600; }
  .footer { text-align: center; padding: 24px; font-size: 13px; color: var(--gray); }
</style>
</head>
<body>
<div class="header">
  <h1>🛡️ QA Buddy Report</h1>
  <div class="meta">%s &nbsp;•&nbsp; Run ID: %s &nbsp;•&nbsp; Generated: %s</div>
</div>
<div class="content">

  <div class="summary-grid">
    <div class="summary-card">
      <div class="num">%d</div><div class="label">Total Tests</div>
    </div>
    <div class="summary-card passed">
      <div class="num">%d</div><div class="label">Passed ✅</div>
    </div>
    <div class="summary-card failed">
      <div class="num">%d</div><div class="label">Failed ❌</div>
    </div>
    <div class="summary-card">
      <div class="num">%d</div><div class="label">Skipped ⏭️</div>
    </div>
    <div class="summary-card coverage">
      <div class="num">%.0f%%</div><div class="label">Pass Rate</div>
    </div>
  </div>

  <div class="section">
    <h2>📊 Discovery Summary</h2>
    <div>
      <span class="disc-stat">📄 %d pages discovered</span>
      <span class="disc-stat">🧩 %d modules</span>
      <span class="disc-stat">⏱️ %.1fs test duration</span>
    </div>
    <div style="margin-top:16px">
      <strong>Modules discovered:</strong><br><div style="margin-top:8px">%s</div>
    </div>
  </div>

  <div class="section">
    <h2>📋 Test Results</h2>
    <table>
      <thead>
        <tr><th>Status</th><th>Test Name</th><th>Severity</th><th>Category</th><th>Duration</th><th>Feature</th></tr>
      </thead>
      <tbody>%s</tbody>
    </table>
  </div>

</div>
<div class="footer">Generated by QA Buddy — %s</div>
</body>
</html>`,
		rc.BaseURL,
		rc.BaseURL, rc.RunID, time.Now().Format("Jan 2, 2006 15:04:05"),
		suite.Total, suite.Passed, suite.Failed, suite.Skipped, passRate,
		pages, len(modules), float64(suite.DurationMs)/1000,
		modsList.String(),
		testRows.String(),
		time.Now().Format("2006"),
	)
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}
