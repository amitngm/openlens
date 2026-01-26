# QA Buddy - Intelligent QA Automation Platform

QA Buddy is an enterprise-grade, intelligent QA automation platform that provides predictable test coverage based on actual features discovered in your application.

## 🚀 Quick Start

### Prerequisites

- Python 3.8+
- Node.js (for Playwright)
- Virtual environment (recommended)

### Installation

1. **Navigate to the project directory:**
```bash
cd agent-api
```

2. **Create and activate virtual environment:**
```bash
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

3. **Install dependencies:**
```bash
pip install -r requirements.txt
playwright install
```

4. **Start the server:**
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

5. **Access the UI:**
Open your browser and navigate to: `http://localhost:8080/ui/`

## 📋 Features

- **Intelligent Discovery**: Automatically discovers pages and features in your application
- **Live Validation**: Performs real-time validation during discovery
- **Test Case Generation**: Generates comprehensive test cases covering all validation scenarios
- **Rich Input Support**: Accepts PRD documents, Figma designs, Jira tickets, images, and videos
- **Production-Ready Reports**: Delivers mature test reports with clear metrics
- **Interactive QA**: Interactive question-answer flow for login, context selection, and test intent

## 🏗️ Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture and implementation details.

## 📖 Usage

### Starting a Discovery Run

1. Open the UI at `http://localhost:8080/ui/`
2. Enter your application's base URL
3. Upload requirement documents (PRD, images, etc.) if available
4. Click "Start Discovery Run"
5. Answer any interactive questions (login credentials, context selection, etc.)
6. View test cases and results in real-time

### API Usage

#### Start a Run
```bash
curl -X POST "http://localhost:8080/api/runs/start" \
  -H "Content-Type: application/json" \
  -d '{
    "base_url": "https://your-app.com",
    "env": "dev"
  }'
```

#### Check Status
```bash
curl "http://localhost:8080/api/runs/{run_id}/status"
```

#### Answer Questions
```bash
curl -X POST "http://localhost:8080/api/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "login_creds", "answer": "username,password"}'
```

#### Get Report
```bash
curl "http://localhost:8080/api/runs/{run_id}/report" > report.html
```

## 🔗 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/runs/start` | POST | Start a new discovery run |
| `/api/runs/{id}/status` | GET | Get run status and current question |
| `/api/runs/{id}/answer` | POST | Answer an interactive question |
| `/api/runs/{id}/report` | GET | Get test execution report |
| `/health` | GET | Health check endpoint |
| `/docs` | GET | Interactive API documentation |

## 📁 Project Structure

```
qa-agent/
├── agent-api/
│   ├── app/
│   │   ├── main.py              # FastAPI application
│   │   ├── routers/             # API routes
│   │   ├── services/            # Business logic
│   │   ├── models/              # Data models
│   │   └── database/            # Database layer
│   ├── ui/
│   │   └── index.html           # Web UI
│   └── requirements.txt         # Python dependencies
└── README.md                    # This file
```

## 🐳 Docker Support

```bash
cd agent-api
docker-compose up
```

## 🧪 Testing

```bash
# Run API contract tests
python test_api_contract.py

# Run interactive flow tests
python test_interactive_flow.py --mock
```

## 📝 License

[Add your license information here]

## 🤝 Contributing

[Add contribution guidelines here]

## 📞 Support

[Add support/contact information here]
