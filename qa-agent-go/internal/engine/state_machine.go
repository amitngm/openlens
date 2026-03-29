package engine

import (
	"fmt"
	"time"

	"github.com/qabuddy/agent/internal/database"
	"github.com/qabuddy/agent/internal/models"
	"github.com/qabuddy/agent/internal/store"
	"github.com/rs/zerolog/log"
)

// allowedTransitions defines the valid state transitions
var allowedTransitions = map[models.RunState][]models.RunState{
	models.StateStart:             {models.StateOpenURL},
	models.StateOpenURL:           {models.StateSessionCheck, models.StateStuckDetected, models.StateFailed},
	models.StateSessionCheck:      {models.StateLoginDetect, models.StateContextDetect},
	models.StateLoginDetect:       {models.StateWaitLoginInput, models.StateWaitManualLogin, models.StateContextDetect, models.StateDiscoveryRun},
	models.StateWaitLoginInput:    {models.StateLoginAttempt, models.StateWaitManualLogin, models.StateDiscoveryRun, models.StateCancelled},
	models.StateLoginAttempt:      {models.StatePostLoginValidate, models.StateWaitLoginInput, models.StateFailed},
	models.StatePostLoginValidate: {models.StateContextDetect, models.StateWaitLoginInput, models.StateWaitManualLogin, models.StateFailed},
	models.StateWaitManualLogin:   {models.StateContextDetect, models.StateDiscoveryRun, models.StateCancelled},
	models.StateContextDetect:     {models.StateDiscoveryRun},
	models.StateDiscoveryRun:      {models.StateDiscoverySummary, models.StateStuckDetected, models.StateFailed},
	models.StateDiscoverySummary:  {models.StateCRUDExplore, models.StateWaitTestIntent, models.StateTestPlanBuild},
	models.StateCRUDExplore:       {models.StateWaitTestIntent, models.StateTestPlanBuild, models.StateFailed},
	models.StateWaitTestIntent:    {models.StateTestPlanBuild, models.StateCancelled},
	models.StateTestPlanBuild:     {models.StateTestExecute, models.StateFailed},
	models.StateTestExecute:       {models.StateReportGenerate, models.StateFailed},
	models.StateReportGenerate:    {models.StateDone},
	models.StateStuckDetected:     {models.StateWaitBuddyGuidance, models.StateOpenURL, models.StateSessionCheck, models.StateDiscoveryRun, models.StateTestExecute},
	models.StateWaitBuddyGuidance: {models.StateOpenURL, models.StateSessionCheck, models.StateDiscoveryRun, models.StateTestExecute, models.StateStuckDetected, models.StateWaitManualLogin, models.StateCancelled},
	models.StateDone:              {},
	models.StateFailed:            {},
	models.StateCancelled:         {},
}

// StateMachine manages state transitions for runs
type StateMachine struct {
	runStore *store.RunStore
	db       *database.DB
}

// NewStateMachine creates a new StateMachine
func NewStateMachine(s *store.RunStore, db *database.DB) *StateMachine {
	return &StateMachine{runStore: s, db: db}
}

// Transition moves a run to a new state with a buddy message
func (sm *StateMachine) Transition(runID string, newState models.RunState, buddyMsg string) error {
	ctx, ok := sm.runStore.Get(runID)
	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}

	// Validate transition
	if !sm.isAllowed(ctx.State, newState) {
		return fmt.Errorf("invalid transition %s -> %s", ctx.State, newState)
	}

	prevState := ctx.State
	ctx.PrevState = prevState
	ctx.State = newState
	ctx.BuddyMsg = buddyMsg
	ctx.UpdatedAt = time.Now()

	// Update progress based on state
	ctx.Progress = stateProgress(newState)

	sm.runStore.Update(ctx)

	// Persist to DB
	if sm.db != nil {
		if err := sm.db.SaveRun(ctx); err != nil {
			log.Warn().Err(err).Str("run_id", runID).Msg("failed to persist run state")
		}
	}

	log.Info().
		Str("run_id", runID).
		Str("from", string(prevState)).
		Str("to", string(newState)).
		Str("msg", buddyMsg).
		Msg("state transition")

	return nil
}

// SetQuestion sets an interactive question for the user
func (sm *StateMachine) SetQuestion(runID, question, questionType string, hints []string) error {
	ctx, ok := sm.runStore.Get(runID)
	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}
	ctx.Question = question
	ctx.QuestionType = questionType
	ctx.QuestionHints = hints
	sm.runStore.Update(ctx)
	return nil
}

// SetStuck marks a run as stuck with screenshot and reason
func (sm *StateMachine) SetStuck(runID, reason, screenshot string, hints []string) error {
	ctx, ok := sm.runStore.Get(runID)
	if !ok {
		return fmt.Errorf("run %s not found", runID)
	}
	ctx.StuckReason = reason
	ctx.StuckScreenshot = screenshot
	ctx.Question = "I'm stuck! What should I do next?"
	ctx.QuestionType = "stuck"
	ctx.QuestionHints = hints

	// Transition to stuck state
	return sm.Transition(runID, models.StateStuckDetected, "Unexpected screen detected. "+reason)
}

func (sm *StateMachine) isAllowed(from, to models.RunState) bool {
	allowed, ok := allowedTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}

func stateProgress(state models.RunState) int {
	progress := map[models.RunState]int{
		models.StateStart:             0,
		models.StateOpenURL:           5,
		models.StateSessionCheck:      10,
		models.StateLoginDetect:       12,
		models.StateWaitLoginInput:    12,
		models.StateLoginAttempt:      15,
		models.StatePostLoginValidate: 18,
		models.StateContextDetect:     20,
		models.StateDiscoveryRun:      25,
		models.StateDiscoverySummary:  60,
		models.StateCRUDExplore:       63,
		models.StateWaitTestIntent:    65,
		models.StateTestPlanBuild:     65,
		models.StateTestExecute:       70,
		models.StateReportGenerate:    95,
		models.StateDone:              100,
		models.StateFailed:            0,
		models.StateStuckDetected:     0,
		models.StateWaitBuddyGuidance: 0,
		models.StateWaitManualLogin:   13,
	}
	if p, ok := progress[state]; ok {
		return p
	}
	return 0
}
