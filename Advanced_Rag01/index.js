// How Parallel Query Retrieval Works:
const express = require("express");
const dotenv = require("dotenv");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { QdrantClient } = require("@qdrant/js-client-rest");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const cors = require("cors");
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const upload = multer({ dest: "uploads/" });
const port = 8000;

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const chatModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
// In Qdrant client initialization
const qdrant = new QdrantClient({
  url: "http://localhost:6334",
});
// Initialize Qdrant collection name
const collectionName = "pdfs";
// Initialize Qdrant collection parameters
const createCollectionIfNeeded = async () => {
    const collections = await qdrant.getCollections();
    const exists = collections.collections?.some(
      (c) => c.name === collectionName
    );
  
    if (!exists) {
      await qdrant.createCollection(collectionName, {
        vectors: {
          size: 768, // Must match embedding dimension
          distance: "Cosine",
        },
      });
    }
  };
// Load and parse PDF
const loadPDF = async (path) => {
  const buffer = fs.readFileSync(path);
  const data = await pdfParse(buffer);
  return data.text;
};
// Split text into chunks
const splitText = async (text) => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  return await splitter.createDocuments([text]);
};
// Generate embedding for a given text
const generateEmbedding = async (text) => {
  const embeddingModel = genAI.getGenerativeModel({
    model: "models/text-embedding-004",
  });
  // CORRECT PAYLOAD FORMAT
  const result = await embeddingModel.embedContent({
    content: {
      parts: [{ text: text }],
    },
  });
  return result.embedding.values;
};
// POST endpoint to upload a PDF and process it
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded.");
    }
    await createCollectionIfNeeded();
    const filePath = req.file.path;
    const text = await loadPDF(filePath);
    const docs = await splitText(text);
    const points = await Promise.all(
      docs.map(async (doc) => {
        const embedding = await generateEmbedding(doc.pageContent);
        return {
          id: uuidv4(),
          vector: embedding,
          payload: {
            pageContent: doc.pageContent,
          },
        };
      })
    );

    await qdrant.upsert(collectionName, {
      wait: true,
      points,
    });

    res.send("PDF uploaded, embedded, and stored in Qdrant!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error processing file.");
  }
});

// Query expansion
async function generateVariations(query,num=3){
    const prompt=`Generate ${num} variations of the following query: "${query}"`;
    const result=await chatModel.generateContent(prompt);
    return [query,...result.response.text().split("\n").filter(q=>q.trim()!=="")];
}
// Semantic searc
async function retrieveDocs(queries,k=3){
    const results=[];
    for(const query of queries){
        const embedding=await generateEmbedding(query);
        const searchResult=await qdrant.search(collectionName,{
            vector:embedding,
            top:k,
        });
        for (const hit of searchResult) {
          results.push(hit.payload.pageContent); // Directly store page content
      }
    }

    const seen=new Set();
    const unique=[];
    console.log("Unique results count:");
    for(const r of results){
      console.log(r);
        const txt=r.replace(/[\r\n]+/g," ").trim();
        if(!seen.has(txt)){
            seen.add(txt);
            unique.push(r);
        }
    }
    console.log("Unique results count:9999");
    return unique;
}
// POST endpoint to ask a question

app.post("/ask", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).send("Query required");

    // 1. Generate variations
    const variations = await generateVariations(query);
    console.log("Variations:", variations);

    // 2. Retrieve documents
    console.log("Retrieving documents...");
    const docs = await retrieveDocs(variations,3);
    console.log("Retrieved documents:", docs);
    console.log("Number of documents retrieved:", docs.length);

    // 3. Prepare context
    const context = docs.join('\n\n---\n\n');
    const systemPrompt = `
You are a smart PDF assistant designed to help users understand the content of a PDF document. Your task is to provide accurate, clear, and concise responses based on the user's query and the relevant excerpts from the PDF. Follow these guidelines to ensure your responses are helpful and aligned with the user's intent:

1. **Understand the Query Type**:
   - If the user asks for a **summary**, provide a high-level overview of the main content, focusing on key points or themes.
   - If the user asks for **specific information** (e.g., "What is [term]?"), locate and present that information directly.
   - If the user asks for an **explanation** (e.g., "Explain [concept]"), provide a clear, general overview first, adding specifics only if requested.
   - If the query is vague, assume a general understanding is desired and respond concisely.

2. **Use the PDF Excerpts**:
   - Base your response solely on the provided PDF excerpts. Do not add information beyond what’s in the document.
   - If the excerpts lack the requested information, say: "The PDF does not contain this information."

3. **Tailor the Response**:
   - For **general queries**, prioritize broad, introductory content over technical details.
   - For **specific queries**, focus on the exact details requested, keeping it brief.
   - Synthesize information from multiple excerpts into a single, coherent answer if needed.

4. **Structure Your Answer**:
   - Start with a short, direct response to the query.
   - Add supporting details or context as appropriate, especially for explanations.
   - Keep responses concise for specific questions and slightly longer for summaries or explanations.

5. **Ensure Clarity**:
   - Use simple, clear language.
   - Avoid unnecessary jargon unless it’s central to the query and explained.

If the query is unclear, ask the user for clarification to ensure an accurate response.
 Context:${context}
`;

    // 4. Model configuration
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: systemPrompt,
    });

    // 5. Generate response
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: query }] }],
      generationConfig: { responseMimeType: "application/json" },
    });

    // 6. Handle response
    // const response = await result.response;
    const ans = await result.response.text();
    
    try {
      const parsed = JSON.parse(ans);
      res.json({ message: parsed });
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError.message);
      console.error("Raw Response:", ans);
      res.status(500).send("Invalid response format");
    }

  } catch (err) {
    console.error("Full Error Stack:", err);
    res.status(500).send("Failed to process request");
  }
});
app.listen(port, () => {
  console.log(`Gemini Qdrant app running at http://localhost:${port}`);
});