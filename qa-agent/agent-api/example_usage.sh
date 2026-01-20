#!/bin/bash
# Example usage script for Interactive QA Buddy
# This demonstrates a complete workflow

set -e

API_URL="${API_URL:-http://localhost:8000}"
TARGET_URL="${TARGET_URL:-https://example.com}"

echo "=========================================="
echo "Interactive QA Buddy - Example Usage"
echo "=========================================="
echo ""
echo "API URL: $API_URL"
echo "Target URL: $TARGET_URL"
echo ""

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "⚠️  jq not found. Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    echo "   Continuing without jq (output will be less readable)..."
    USE_JQ=false
else
    USE_JQ=true
fi

# Function to pretty print JSON
pp() {
    if [ "$USE_JQ" = true ]; then
        jq .
    else
        cat
    fi
}

# Step 1: Start a run
echo "📋 Step 1: Starting run..."
START_RESPONSE=$(curl -s -X POST "$API_URL/api/runs/start" \
  -H "Content-Type: application/json" \
  -d "{
    \"base_url\": \"$TARGET_URL\",
    \"env\": \"dev\",
    \"headless\": true
  }")

if [ "$USE_JQ" = true ]; then
    RUN_ID=$(echo "$START_RESPONSE" | jq -r '.run_id')
    STATE=$(echo "$START_RESPONSE" | jq -r '.state')
else
    RUN_ID=$(echo "$START_RESPONSE" | grep -o '"run_id":"[^"]*' | cut -d'"' -f4)
    STATE=$(echo "$START_RESPONSE" | grep -o '"state":"[^"]*' | cut -d'"' -f4)
fi

if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
    echo "❌ Failed to start run"
    echo "$START_RESPONSE" | pp
    exit 1
fi

echo "✅ Run started: $RUN_ID"
echo "   Initial state: $STATE"
echo ""

# Step 2: Check status and handle questions
echo "📋 Step 2: Monitoring run and answering questions..."
echo ""

MAX_ITERATIONS=30
ITERATION=0

while [ $ITERATION -lt $MAX_ITERATIONS ]; do
    # Get status
    STATUS_RESPONSE=$(curl -s "$API_URL/api/runs/$RUN_ID/status")
    
    if [ "$USE_JQ" = true ]; then
        CURRENT_STATE=$(echo "$STATUS_RESPONSE" | jq -r '.state')
        QUESTION=$(echo "$STATUS_RESPONSE" | jq -r '.question // empty')
        PROGRESS=$(echo "$STATUS_RESPONSE" | jq -r '.progress // 0')
    else
        CURRENT_STATE=$(echo "$STATUS_RESPONSE" | grep -o '"state":"[^"]*' | cut -d'"' -f4)
        PROGRESS="?"
    fi
    
    echo "   State: $CURRENT_STATE (Progress: ${PROGRESS}%)"
    
    # Check if done
    if [ "$CURRENT_STATE" = "DONE" ] || [ "$CURRENT_STATE" = "FAILED" ]; then
        echo ""
        echo "✅ Run completed with state: $CURRENT_STATE"
        break
    fi
    
    # Check for questions
    if [ "$USE_JQ" = true ] && [ -n "$QUESTION" ] && [ "$QUESTION" != "null" ]; then
        Q_ID=$(echo "$STATUS_RESPONSE" | jq -r '.question.id')
        Q_TYPE=$(echo "$STATUS_RESPONSE" | jq -r '.question.type')
        Q_TEXT=$(echo "$STATUS_RESPONSE" | jq -r '.question.text')
        
        echo "   ⚠️  Question detected: $Q_TEXT"
        
        ANSWER=""
        
        # Handle different question types
        if [ "$Q_TYPE" = "text" ] && echo "$Q_TEXT" | grep -qi "login\|credential"; then
            # Login question
            echo "   → Detected login question"
            ANSWER="testuser,testpass123"
            echo "   → Answering with: $ANSWER"
        
        elif [ "$Q_TYPE" = "select_one" ] && echo "$Q_TEXT" | grep -qi "context\|tenant\|project"; then
            # Context question
            echo "   → Detected context question"
            FIRST_OPTION=$(echo "$STATUS_RESPONSE" | jq -r '.question.options[0].id')
            ANSWER="$FIRST_OPTION"
            echo "   → Answering with: $ANSWER"
        
        elif [ "$Q_TYPE" = "select_one" ] && echo "$Q_TEXT" | grep -qi "test"; then
            # Test intent question
            echo "   → Detected test intent question"
            ANSWER="smoke"
            echo "   → Answering with: $ANSWER"
        
        elif [ "$Q_TYPE" = "confirm" ]; then
            # Confirmation question
            echo "   → Detected confirmation question"
            ANSWER="yes"
            echo "   → Answering with: $ANSWER"
        fi
        
        if [ -n "$ANSWER" ]; then
            # Answer the question
            ANSWER_RESPONSE=$(curl -s -X POST "$API_URL/api/runs/$RUN_ID/answer" \
              -H "Content-Type: application/json" \
              -d "{
                \"question_id\": \"$Q_ID\",
                \"answer\": \"$ANSWER\"
              }")
            
            echo "   ✅ Answer submitted"
            sleep 3  # Wait for processing
        else
            echo "   ⚠️  No auto-answer handler for this question type"
            echo "   Please answer manually via:"
            echo "   curl -X POST \"$API_URL/api/runs/$RUN_ID/answer\" \\"
            echo "     -H \"Content-Type: application/json\" \\"
            echo "     -d '{\"question_id\": \"$Q_ID\", \"answer\": \"your_answer\"}'"
            break
        fi
    else
        # No question, wait a bit
        sleep 2
    fi
    
    ITERATION=$((ITERATION + 1))
done

if [ $ITERATION -ge $MAX_ITERATIONS ]; then
    echo ""
    echo "⚠️  Reached max iterations ($MAX_ITERATIONS)"
fi

# Step 3: Get final status
echo ""
echo "📋 Step 3: Final status..."
FINAL_STATUS=$(curl -s "$API_URL/api/runs/$RUN_ID/status")
echo "$FINAL_STATUS" | pp

# Step 4: Get report
echo ""
echo "📋 Step 4: Getting HTML report..."
REPORT_FILE="report_${RUN_ID}.html"
curl -s "$API_URL/api/runs/$RUN_ID/report" > "$REPORT_FILE"

if [ -f "$REPORT_FILE" ] && [ -s "$REPORT_FILE" ]; then
    echo "✅ Report saved to: $REPORT_FILE"
    echo "   Open with: open $REPORT_FILE"
else
    echo "⚠️  Report not available yet (run may still be in progress)"
fi

echo ""
echo "=========================================="
echo "Complete! Run ID: $RUN_ID"
echo "=========================================="
