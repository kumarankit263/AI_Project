const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const yahooFinance = require('yahoo-finance2').default;

dotenv.config();
const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// TOOL DEFINITIONS
const tools = {
    get_weather: {
        fn: async (city) => {
            console.log("🔨 Tool Called: get_weather", city);
            try {
                const url = `https://wttr.in/${city}?format=%C+%t`;
                const res = await axios.get(url);
                return `The weather in ${city} is ${res.data}.`;
            } catch (error) {
                return "Something went wrong while fetching the weather data.";
            }
        },
    },
    run_command: {
        fn: async (command) => {
            console.log("🔨 Tool Called: run_command", command);
            const { exec } = require("child_process");
            return new Promise((resolve) => {
                exec(command, (error, stdout, stderr) => {
                    if (error) resolve(stderr || error.message);
                    else {
                        resolve(stdout);
                    }
                });
            });
        },
    },
    get_stock_price: {
        fn: async (ticker) => {
          console.log("🔨 Tool Called: get_stock_price", ticker);
          try {
            const quote = await yahooFinance.quote(ticker);
            return `The current price of ${ticker} is $${quote.regularMarketPrice}.`;
          } catch (err) {
            return `Couldn't fetch stock info for ${ticker}.`;
          }
        }
      },
    
      get_stock_history: {
        fn: async ({ ticker, period }) => {
          console.log("🔨 Tool Called: get_stock_history", ticker, period);
          try {
            const result = await yahooFinance.historical(ticker, { period1: period.start, period2: period.end });
            const prices = result.map(day => ({
              date: day.date.toISOString().split('T')[0],
              close: day.close
            }));
            return `Stock history for ${ticker} from ${period.start} to ${period.end}:\n${JSON.stringify(prices, null, 2)}`;
          } catch (err) {
            return `Error fetching history for ${ticker}.`;
          }
        }
      },
    
      get_top_gainers: {
        fn: async () => {
          console.log("🔨 Tool Called: get_top_gainers");
          try {
            const data = await yahooFinance.trendingSymbols("US");
            const symbols = data.quotes.map(q => `${q.symbol} ($${q.regularMarketPrice})`);
            return `Top trending stocks today:\n${symbols.slice(0, 5).join('\n')}`;
          } catch (err) {
            return "Failed to fetch top gainers.";
          }
        }
      },
    
      get_company_info: {
        fn: async (ticker) => {
          console.log("🔨 Tool Called: get_company_info", ticker);
          try {
            const info = await yahooFinance.quoteSummary(ticker, { modules: ['assetProfile'] });
            const profile = info.assetProfile;
            return `${profile.longBusinessSummary}\nIndustry: ${profile.industry}, Sector: ${profile.sector}`;
          } catch (err) {
            return `Could not retrieve company information for ${ticker}.`;
          }
        }
      }
    }

system_prompt = `
    You are an helpfull AI Assistant who is specialized in resolving user query.
    You work on start, plan, action, observe mode.
    For the given user query and available tools, plan the step by step execution, based on the planning,
    select the relevant tool from the available tool. and based on the tool selection you perform an action to call the tool.
    Wait for the observation and based on the observation from the tool call resolve the user query.

    Rules:
    - Follow the Output JSON Format.
    - Always perform one step at a time and wait for next input
    - Carefully analyse the user query

    Output JSON Format:
    {{   
        "step": "string",
        "content": "string",
        "function": "The name of function if the step is action",
        "input": "The input parameter for the function",
    }}

    Available Tools:
    - get_weather: Takes a city name as an input and returns the current weather for the city
    - run_command: Takes a command as input to execute on system and returns ouput
    - get_stock_price: Takes a stock ticker (like AAPL or TSLA) and returns the current price
    - get_stock_history: Takes a ticker and a date range, returns historical close prices
    - get_top_gainers: Returns a list of top trending stocks today
    - get_company_info: Takes a stock ticker and returns company summary info
    
    Example:
    User Query: What is the weather of new york?
    Output: {{ "step": "plan", "content": "The user is interseted in weather data of new york" }}
    Output: {{ "step": "plan", "content": "From the available tools I should call get_weather" }}
    Output: {{ "step": "action", "function": "get_weather", "input": "new york" }}
    Output: {{ "step": "observe", "output": "12 Degree Cel" }}
    Output: {{ "step": "output", "content": "The weather for new york seems to be 12 degrees." }}
`;

app.post("/chat", async (req, res) => {
    const query = req.body.query;
    if (!query) {
        return res.status(400).json({ error: "No query provided" });
    }
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: system_prompt,
    });

    const history = [
        { role: "system", content: system_prompt },
        { role: "user", content: query },
    ];

    while (true) {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: JSON.stringify(history) }] }],
            generationConfig: { responseMimeType: "application/json" },
        });
        const responseText = result.response.text();
        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch (err) {
            return res
                .status(500)
                .json({ or: "Invalid JSON from Gemini", raw: responseText });
        }
        history.push({ role: "assistant", content: JSON.stringify(parsed) });
        //console.log("Gemini Response:", parsed); // Console log here

        if (parsed.step === "plan") {
            console.log("🧠 Plan:", parsed.content);
            continue;
        }
        if (parsed.step === "action") {
            console.log("🚀 Action:", parsed.function, parsed.input);
            const fn = tools[parsed.function];
            if (fn) {
                const result = await fn(parsed.input);
                const obs = { step: "observe", output: result };
                history.push({ role: "assistant", content: JSON.stringify(obs) });
                continue;
            } else {
                return res.status(500).json({ error: "Invalid function call" });
            }
        }

        if (parsed.step === "output") {
            console.log("🤖 Output:", parsed.content);
            return res.json({ result: parsed.content });
        }
        return res.json({ error: "Unrecognized step", raw: parsed });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
