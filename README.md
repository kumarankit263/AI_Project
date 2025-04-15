# 🧠 AI Reasoning Agent API

This project is an intelligent AI assistant that performs actions based on user queries using Google Gemini and custom tools. It follows a step-by-step reasoning loop: **plan → action → observe → output**.

## 🚀 Features

- 🔁 Step-by-step agent with tool usage logic
- ☁️ `get_weather`: Get real-time weather info by city
- 📈 `get_stock_price`: Get current stock price of a ticker
- 📊 `get_stock_history`: Get historical stock data over a date range
- 🔝 `get_top_gainers`: Get top trending stocks
- 🏢 `get_company_info`: Get a brief about what a company does
- 💻 `run_command`: Run system commands from user queries (⚠️ dev only)

## 🧰 Tech Stack

- Node.js + Express
- Google Gemini API (via `@google/generative-ai`)
- Yahoo Finance API (`yahoo-finance2`)
- Axios
- dotenv

---

## 📦 Installation

```bash
git clone https://github.com/your-username/AI_Project.git
cd AI_Project
npm install

🛠️ Tool Functions

Tool	Description	Input Format
get_weather	Current weather in a city	"Delhi"
get_stock_price	Current price of a stock	"AAPL"
get_stock_history	Historical stock data	{ "ticker": "AAPL", "period": { "start": "2024-12-01", "end": "2025-01-01" } }
get_top_gainers	Trending stocks today	None
get_company_info	Description of a company	"GOOGL"
run_command	Executes a terminal command (use cautiously)	"ls -l"

📁 Folder Structure
AI_Project/
├── agents/                # Your modular tools (e.g., stock, weather)
├── index.js               # Main Express app with agent logic
├── package.json
├── .env
└── README.md

