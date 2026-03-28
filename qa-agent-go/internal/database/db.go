package database

import (
	"encoding/json"
	"time"

	"github.com/qabuddy/agent/internal/models"
	"github.com/rs/zerolog/log"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// DB is the database instance
type DB struct {
	gorm *gorm.DB
}

// DBRun is the GORM model for persisting run contexts
type DBRun struct {
	RunID        string    `gorm:"primaryKey"`
	BaseURL      string    `gorm:"not null"`
	State        string    `gorm:"not null"`
	AppType      string
	Headless     bool
	AutoMode     bool
	Progress     int
	PassCount    int
	FailCount    int
	SkipCount    int
	ErrorMessage string
	ReportPath   string
	ContextJSON  string `gorm:"type:text"` // full JSON blob
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// Initialize sets up the database connection and runs migrations
func Initialize(dbPath string) (*DB, error) {
	gormDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}

	if err := gormDB.AutoMigrate(
		&DBRun{},
		&models.TestBenchmark{},
		&models.BlockerPattern{},
	); err != nil {
		return nil, err
	}

	log.Info().Str("db", dbPath).Msg("database initialized")
	return &DB{gorm: gormDB}, nil
}

// SaveRun persists a RunContext to the database
func (db *DB) SaveRun(ctx *models.RunContext) error {
	data, err := json.Marshal(ctx)
	if err != nil {
		return err
	}
	record := DBRun{
		RunID:        ctx.RunID,
		BaseURL:      ctx.BaseURL,
		State:        string(ctx.State),
		AppType:      string(ctx.AppType),
		Headless:     ctx.Headless,
		AutoMode:     ctx.AutoMode,
		Progress:     ctx.Progress,
		PassCount:    ctx.PassCount,
		FailCount:    ctx.FailCount,
		SkipCount:    ctx.SkipCount,
		ErrorMessage: ctx.ErrorMessage,
		ReportPath:   ctx.ReportPath,
		ContextJSON:  string(data),
		CreatedAt:    ctx.CreatedAt,
		UpdatedAt:    ctx.UpdatedAt,
	}
	return db.gorm.Save(&record).Error
}

// LoadRun retrieves a RunContext from the database
func (db *DB) LoadRun(runID string) (*models.RunContext, error) {
	var record DBRun
	if err := db.gorm.First(&record, "run_id = ?", runID).Error; err != nil {
		return nil, err
	}
	var ctx models.RunContext
	if err := json.Unmarshal([]byte(record.ContextJSON), &ctx); err != nil {
		return nil, err
	}
	return &ctx, nil
}

// ListRuns returns recent run summaries
func (db *DB) ListRuns(limit int) ([]*models.RunContext, error) {
	var records []DBRun
	if err := db.gorm.Order("created_at desc").Limit(limit).Find(&records).Error; err != nil {
		return nil, err
	}
	result := make([]*models.RunContext, 0, len(records))
	for _, r := range records {
		var ctx models.RunContext
		if err := json.Unmarshal([]byte(r.ContextJSON), &ctx); err != nil {
			log.Warn().Err(err).Str("run_id", r.RunID).Msg("failed to unmarshal run context")
			continue
		}
		result = append(result, &ctx)
	}
	return result, nil
}

// SaveBenchmark upserts a test benchmark record
func (db *DB) SaveBenchmark(b *models.TestBenchmark) error {
	return db.gorm.Save(b).Error
}

// GetBenchmark retrieves a benchmark by fingerprint
func (db *DB) GetBenchmark(fingerprint string) (*models.TestBenchmark, error) {
	var b models.TestBenchmark
	if err := db.gorm.First(&b, "fingerprint = ?", fingerprint).Error; err != nil {
		return nil, err
	}
	return &b, nil
}

// ListBenchmarks retrieves benchmarks optionally filtered by status
func (db *DB) ListBenchmarks(status string) ([]*models.TestBenchmark, error) {
	query := db.gorm.Order("updated_at desc")
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var records []*models.TestBenchmark
	return records, query.Find(&records).Error
}

// SaveBlockerPattern saves a learned blocker pattern
func (db *DB) SaveBlockerPattern(p *models.BlockerPattern) error {
	return db.gorm.Save(p).Error
}

// ListBlockerPatterns retrieves all blocker patterns
func (db *DB) ListBlockerPatterns() ([]*models.BlockerPattern, error) {
	var records []*models.BlockerPattern
	return records, db.gorm.Order("applied_count desc").Find(&records).Error
}

// UpdateBlockerApplied increments the applied count for a blocker pattern
func (db *DB) UpdateBlockerApplied(id uint) error {
	return db.gorm.Model(&models.BlockerPattern{}).
		Where("id = ?", id).
		UpdateColumn("applied_count", gorm.Expr("applied_count + 1")).Error
}
