const express = require("express");
require('dotenv').config();
const cors = require("cors");
const bodyParser = require("body-parser");
const { OpenAI } = require("openai");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse');
const axios = require('axios');

// LangChain & Supabase imports
const { createClient } = require('@supabase/supabase-js');
const { OpenAIEmbeddings } = require("@langchain/openai");
const { SupabaseVectorStore } = require("@langchain/community/vectorstores/supabase");
// Bring in necessary loaders and splitters
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf"); 
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter"); 

const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

const app = express();
app.use(cors({
  origin: "http://localhost:3000"
}));

app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Initialize Supabase Client & OpenAI Embeddings --- 
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error("ERROR: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env");
    // process.exit(1); // Optional: exit if Supabase is essential
}

const supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

const embeddings = new OpenAIEmbeddings({ 
    apiKey: process.env.OPENAI_API_KEY // Pass API key if not globally set via env var
});

// --- Weather Forecast Function ---
async function getWeatherForecast(location) {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) {
        console.log("Weather API Key (WEATHER_API_KEY) not found in .env");
        return null;
    }

    try {
        // 1. Geocode location name to lat/lon
        const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${apiKey}`;
        const geoResponse = await axios.get(geoUrl);
        
        if (!geoResponse.data || geoResponse.data.length === 0) {
            console.log(`Could not find coordinates for location: ${location}`);
            return `Kon geen coördinaten vinden voor ${location}.`;
        }
        
        const { lat, lon, name: foundName } = geoResponse.data[0];
        console.log(`Found coordinates for ${location}: lat=${lat}, lon=${lon}`);

        // 2. Get 5-day forecast (includes tomorrow)
        const forecastUrl = `http://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=nl`;
        const forecastResponse = await axios.get(forecastUrl);
        
        if (!forecastResponse.data || !forecastResponse.data.list) {
             console.log(`Could not retrieve forecast for ${location}`);
            return `Kon geen weersverwachting ophalen voor ${foundName || location}.`;
        }

        // 3. Find tomorrow's forecast data (e.g., around midday)
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDateString = tomorrow.toISOString().split('T')[0];
        
        let relevantForecasts = forecastResponse.data.list.filter(item => 
            item.dt_txt.startsWith(tomorrowDateString)
        );

        if (relevantForecasts.length === 0) {
             return `Geen specifieke voorspelling gevonden voor morgen in ${foundName || location}.`;
        }

        // Take forecast around midday if available, otherwise first available
        let targetForecast = relevantForecasts.find(item => item.dt_txt.includes("12:00:00")) || relevantForecasts[0];

        // 4. Format summary
        const temp = Math.round(targetForecast.main.temp);
        const feelsLike = Math.round(targetForecast.main.feels_like);
        const description = targetForecast.weather[0]?.description || 'geen beschrijving';
        const windSpeed = Math.round(targetForecast.wind.speed * 3.6); // m/s to km/h
        const rainProb = targetForecast.pop * 100; // Probability of precipitation

        let summary = `Verwachting rond ${targetForecast.dt_txt.split(' ')[1]}: Temp ${temp}°C (voelt als ${feelsLike}°C), ${description}, wind ${windSpeed} km/u. Kans op neerslag: ${rainProb.toFixed(0)}%.`;
        
        return summary;
        
    } catch (error) {
        console.error("Error fetching weather data:", error.message);
        if (error.response) {
             console.error("Weather API response error:", error.response.data);
        }
        return "Er is een fout opgetreden bij het ophalen van het weerbericht.";
    }
}
// --- End Weather Forecast Function ---

app.post("/chat", upload.single('chatFile'), async (req, res) => {
  console.log("--- New /chat request ---");
  const { prompt } = req.body;
  console.log("Extracted prompt variable:", prompt);

  let userProfile = {};
  let incomingChatHistory = [];
  try {
      userProfile = JSON.parse(req.body.userProfile || '{}');
      incomingChatHistory = JSON.parse(req.body.chatHistory || '[]');
  } catch(e) {
      console.error("Kon userProfile of chatHistory niet parsen:", e);
  }
  
  const uploadedFile = req.file;
  let fileContent = '';

  if (uploadedFile) {
    console.log("Bestand ontvangen:", uploadedFile.originalname, "Path:", uploadedFile.path);
    try {
      if (uploadedFile.mimetype === 'application/pdf') {
        const dataBuffer = fs.readFileSync(uploadedFile.path);
        const data = await pdf(dataBuffer);
        fileContent = `\n\n--- Start inhoud ${uploadedFile.originalname} ---\n${data.text}\n--- Einde inhoud ${uploadedFile.originalname} ---`;
        console.log(`Tekst succesvol geëxtraheerd uit ${uploadedFile.originalname}`);
      } else {
        fileContent = `\n\n[Bestandstype ${uploadedFile.mimetype} van ${uploadedFile.originalname} wordt nog niet ondersteund voor uitlezen.]`;
      }
    } catch (parseError) {
      console.error("Fout bij parsen bestand:", parseError);
      fileContent = `\n\n[Kon inhoud van bestand ${uploadedFile.originalname} niet lezen. Fout tijdens verwerken.]`;
    } finally {
      fs.unlink(uploadedFile.path, (err) => {
        if (err) console.error("Kon tijdelijk bestand niet verwijderen:", err);
      });
    }
  }

  // --- Check for Weather Query ---
  let weatherContext = null;
  const weatherKeywords = ['weer', 'buiten', 'sporten', 'verwachting', 'regen', 'temperatuur', 'zon'];
  const timeKeywords = ['morgen'];
  const locationRegex = /in\s+([A-ZÀ-ÖØ-Þ][a-zA-ZÀ-ÿ\s\-]+)/i;
  
  const promptLower = prompt?.toLowerCase() || '';
  const includesWeather = weatherKeywords.some(kw => promptLower.includes(kw));
  const includesTomorrow = timeKeywords.some(kw => promptLower.includes(kw));
  const locationMatch = prompt?.match(locationRegex);
  
  console.log(`Weather Query Check: includesWeather=${includesWeather}, includesTomorrow=${includesTomorrow}, locationMatch=${locationMatch ? locationMatch[1] : null}`);
  
  if (includesWeather && includesTomorrow && locationMatch && locationMatch[1]) {
      const locationName = locationMatch[1].trim();
      if (locationName.length > 1) { 
          console.log(`Weather query detected for tomorrow in: ${locationName}`);
          weatherContext = await getWeatherForecast(locationName);
      } else {
         console.log(`Extracted location "${locationName}" too short, ignoring weather query.`);
      }
  } else {
      console.log("Weather query conditions not fully met.");
  }
  // --- End Check for Weather Query ---

  // --- Retrieve Document Context from Supabase --- 
  let documentContext = '';
  try {
      const vectorStore = new SupabaseVectorStore(embeddings, {
          client: supabaseClient,
          tableName: 'documents', // Table name created in Supabase
          queryName: 'match_documents' // Function name created in Supabase
      });

      // Perform similarity search (e.g., get top 3 most relevant chunks)
      const relevantDocs = await vectorStore.similaritySearch(prompt, 3);
      
      if (relevantDocs && relevantDocs.length > 0) {
          console.log(`Found ${relevantDocs.length} relevant document chunks.`);
          // Log de inhoud van de gevonden chunks
          console.log("--- Relevant Chunks Content ---");
          relevantDocs.forEach((doc, index) => {
                // Probeer similarity score te loggen (afhankelijk van vector store implementatie)
                let similarityScore = 'N/A';
                if (doc.metadata && typeof doc.metadata._distance === 'number') {
                     similarityScore = (1 - doc.metadata._distance).toFixed(4); // Cosine similarity = 1 - distance
                }
                console.log(`Chunk ${index + 1} (Similarity: ${similarityScore}):\n`, doc.pageContent.substring(0, 200) + "..."); // Log eerste 200 tekens
          });
          console.log("-----------------------------");

          // Format the context string
          documentContext = relevantDocs.map((doc, index) => 
              `--- Document Fragment ${index + 1} ---\n${doc.pageContent}\n------------------------------`
          ).join('\n\n');
      } else {
          console.log("No relevant document fragments found in Supabase.");
      }

  } catch (dbError) {
      console.error("Error querying Supabase Vector Store:", dbError.message);
      // Don't necessarily stop the chat, just proceed without document context
  }
  // --- End Retrieve Document Context --- 

  // --- Construct System Prompt ---
  let systemMessageBase = "Je bent een behulpzame en enthousiaste Nederlandse fitness coach. Antwoord altijd in het Nederlands.";

  // Updated Core Instructions
  systemMessageBase += " \n**KERNTAKEN:** Focus primair op vragen over voeding, fitness, sport, gezondheid en het gegenereerde voedings-/trainingsschema.";
  systemMessageBase += " \n**WEERVRAGEN:** Je mag ook vragen beantwoorden over het weer, vooral als het relevant is voor buiten sporten. Als de gebruiker vraagt naar het weer voor morgen in een specifieke locatie, gebruik dan de eventueel verstrekte live context. Voor simpele vervolgvragen (zoals \'en in [locatie]?\') direct na een weervraag, ga er vanuit dat de gebruiker het weer voor morgen bedoelt en antwoord op basis van je algemene kennis als er geen live data beschikbaar is.";
  systemMessageBase += " \n**OVERIGE VRAGEN:** Als de gebruiker een vraag stelt die duidelijk buiten deze onderwerpen valt, antwoord dan vriendelijk dat je daar niet mee kunt helpen en bied aan om te assisteren met vragen over voeding, sport of het weer.";

  // Schema modification instruction remains separate
  let schemaModificationInstruction = " \n**INSTRUCTIE (SCHEMA AANPASSEN):** Als de gebruiker vraagt om een aanpassing aan het voedingsschema (bijvoorbeeld door te vragen een item toe te voegen, te verwijderen of te wijzigen, eventueel gebaseerd op info uit een meegestuurd bestand), genereer dan **het volledige, bijgewerkte voedingsschema** opnieuw. Houd je strikt aan exact hetzelfde Markdown-formaat als het originele schema (met Totale Inname, Macronutriënten en Maaltijden met streepjes voor items). Geef GEEN commentaar vóór of na het schema, retourneer ALLEEN het bijgewerkte schema.";

  let systemMessageContent = systemMessageBase;

  if (userProfile) {
    systemMessageContent += ` \nHet profiel van de gebruiker: Huidig Gewicht: ${userProfile.gewicht || 'onbekend'}, Streefgewicht: ${userProfile.streefgewicht || 'onbekend'} (gewenste tijdlijn: ${userProfile.timeline || 'onbekend'}), Lengte: ${userProfile.lengte || 'onbekend'}, Lichaamstype: ${userProfile.bodytype || 'onbekend'}. De focus is ${userProfile.focus || 'niet gespecificeerd'}.`;
  }

  // ADD LIVE WEATHER CONTEXT if available
  if (weatherContext) {
      const locationNameForPrompt = locationMatch[1].trim();
      systemMessageContent += `\n\n**LIVE WEER CONTEXT (Morgen in ${locationNameForPrompt}):** ${weatherContext}. Gebruik deze specifieke data.`;
  }

  // ADD DOCUMENT CONTEXT if available
  if (documentContext) {
      systemMessageContent += `\n\n**BELANGRIJKE CONTEXT UIT DOCUMENT:**\n${documentContext}`;
      systemMessageContent += " \n**ZEER BELANGRIJK:** Als de vraag van de gebruiker betrekking heeft op de inhoud van de hierboven verstrekte document context, baseer je antwoord dan **volledig en uitsluitend** op die context, zelfs als het over specifieke producten of details gaat die buiten je normale kennis vallen. De document context heeft **altijd voorrang**.";
  }

  // Append schema modification instructions if it's not the initial plan generation
  if (!(prompt === "ACTION:GENERATE_INITIAL_PLAN" && !uploadedFile)) {
      systemMessageContent += schemaModificationInstruction; 
  } else {
      // Add initial plan format instructions (assuming this logic is still needed)
      let initialPlanFormat = " \n**FORMAAT INSTRUCTIE (alleen voor initieel plan):** Genereer een praktisch startdagvoedingsschema gebaseerd op het profiel. Formatteer het antwoord exact als volgt, gebruik Nederlandse termen en Markdown: "
                           + "1. Titel: \'## Voedingsschema\', witregel.\n"
                           + "2. Titel: \'### Totale Dagelijkse Inname\', witregel.\n"
                           + "3. Regel: \'Geschatte calorieën: [X] kcal\', witregel.\n"
                           + "4. Titel: \'### Macronutriënten:\', gevolgd door 3 regels eronder, elk beginnend met een streepje en spatie:\n- Vet: [X] g\n- Eiwitten: [Y] g\n- Koolhydraten: [Z] g\n   witregel.\n"
                           + "5. Titel: \'### Maaltijden\', witregel.\n"
                           + "6. Voor elke maaltijd (Ontbijt, Lunch, Diner, Tussendoortjes), gebruik de naam als kop met vier hekjes (bv. \'#### Ontbijt\'), witregel.\n"
                           + "7. Onder elke maaltijdkop, lijst de specifieke voedingsmiddelen op, elk op een **eigen, nieuwe regel**, beginnend met een **streepje en een spatie** (\'- \').\n"
                           + "8. Witregel tussen laatste item van een maaltijd en de kop van de volgende maaltijd.\n"
                           + "9. Geen extra tekst, inleidingen of conclusies. Houd je strikt aan deze structuur.";
      systemMessageContent += initialPlanFormat;
  }
  
  const messagesForApi = [
      { role: "system", content: systemMessageContent },
      ...incomingChatHistory
          // Add checks for msg.role and msg.content existence
          .filter(msg => 
              msg && 
              typeof msg.role === 'string' && 
              typeof msg.content === 'string' && // Ensure content exists and is a string
              !(msg.key === 'loading-plan' || msg.content.startsWith('Error'))
          )
          .map(msg => ({
              role: msg.role === 'ai' ? 'assistant' : msg.role,
              content: msg.content 
          }))
  ];

  // Determine the correct user message content to send
  let finalUserMessageContent = prompt + fileContent; // Default
  if (prompt === "ACTION:GENERATE_INITIAL_PLAN" && !uploadedFile) {
      finalUserMessageContent = "Geef het startvoedingsschema op basis van mijn profiel, volg het zeer specifieke Markdown-formaat (inclusief opsommingstekens voor items) dat in de systeemboodschap is beschreven.";
  }
  messagesForApi.push({ role: "user", content: finalUserMessageContent });

  try {
    console.log("Sending to OpenAI:", messagesForApi);
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messagesForApi,
      max_tokens: 2048,
      temperature: 0.5,
      stream: true, // Request a stream response
    });

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); // Send as plain text stream
    res.setHeader('Transfer-Encoding', 'chunked');

    let fullResponse = ""; // Optional: Store full response server-side if needed later

    // Iterate through the stream chunks
    for await (const chunk of completion) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
            res.write(content); // Write chunk to the response stream
            fullResponse += content;
        }
    }
    res.end(); // End the stream when OpenAI is done
    // console.log("Stream finished. Full response:", fullResponse); // Log full response if needed

  } catch (error) {
    console.error('Error calling OpenAI or streaming:', error);
    // If headers haven't been sent yet, send an error status
    if (!res.headersSent) {
        res.status(500).send(JSON.stringify(error.response?.data?.error?.message || error.response?.data || error.message || "Fout bij communicatie met OpenAI"));
    } else {
        // If stream already started, we can't send a status code, just end it.
        res.end(); 
    }
  }
});

// --- Document Upload Endpoint --- 
app.post("/upload-document", upload.single('documentFile'), async (req, res) => {
    console.log("--- New /upload-document request ---");
    const uploadedFile = req.file;

    if (!uploadedFile) {
        return res.status(400).send("Geen documentbestand ontvangen.");
    }
    
    console.log("Document ontvangen:", uploadedFile.originalname, "Path:", uploadedFile.path);
    
    // Check if it's a PDF
    if (uploadedFile.mimetype !== 'application/pdf') {
        fs.unlink(uploadedFile.path, (err) => { // Clean up temporary file
             if (err) console.error("Kon tijdelijk bestand niet verwijderen:", err);
        });
        return res.status(400).send("Alleen PDF-bestanden worden momenteel ondersteund voor document-upload.");
    }

    try {
        // 1. Load PDF content using LangChain Loader
        //    We pass the temporary file path to the loader.
        //    Using Blob might be more robust if directly handling buffers, but path is simpler here.
        console.log(`Bezig met laden van PDF: ${uploadedFile.path}`);
        const loader = new PDFLoader(uploadedFile.path, {
            // splitPages: false, // Laad als één document ipv per pagina (kan helpen bij context) 
            // Kan meer opties hebben afhankelijk van de loader versie
        });
        const docs = await loader.load();
        console.log(`PDF geladen, ${docs.length} document(en) (paginas?) gevonden.`);

        if (!docs || docs.length === 0) {
            throw new Error("Kon geen tekst extraheren uit de PDF.");
        }

        // 2. Split Documents into Chunks
        console.log("Bezig met splitsen van document...");
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000, // Grootte van de chunks (aantal tekens)
            chunkOverlap: 200, // Overlap tussen chunks
        });
        const splitDocs = await splitter.splitDocuments(docs);
        console.log(`Document gesplitst in ${splitDocs.length} chunks.`);

        // 3. Initialize Vector Store (we need embeddings instance)
        const vectorStore = new SupabaseVectorStore(embeddings, {
            client: supabaseClient,
            tableName: 'documents',
            queryName: 'match_documents'
        });

        // 4. Add Documents to Supabase (generates embeddings and stores)
        console.log("Bezig met opslaan van chunks en embeddings in Supabase...");
        await vectorStore.addDocuments(splitDocs);
        console.log("Document chunks succesvol opgeslagen in Supabase.");

        // 5. Send Success Response
        res.status(200).send(`Document '${uploadedFile.originalname}' succesvol verwerkt en opgeslagen.`);

    } catch (error) {
        console.error("Fout tijdens verwerken document:", error);
        res.status(500).send(`Fout tijdens verwerken document: ${error.message}`);
    } finally {
        // Clean up the temporary file uploaded by multer
        fs.unlink(uploadedFile.path, (err) => {
            if (err) console.error("Kon tijdelijk documentbestand niet verwijderen:", err);
            else console.log(`Tijdelijk bestand ${uploadedFile.path} verwijderd.`);
        });
    }
});

const port = 8060;
app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});