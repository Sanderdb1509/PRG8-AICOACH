# AI Coach Applicatie (PRG8 Project)

Dit project bevat een full-stack webapplicatie, bestaande uit een React frontend (client) en een Node.js/Express backend (server). De applicatie functioneert als een AI-gestuurde fitness- en voedingscoach die communiceert met de OpenAI API, weerinformatie kan ophalen, en vragen kan beantwoorden op basis van geüploade documenten via een Supabase vector database.

## Belangrijkste Features

*   **Chat Interface:** Interactieve chat met AI-coach.
*   **Persoonlijk Profiel:** Gebruikers kunnen hun gegevens en doelen invoeren.
*   **Initieel Voedingsplan:** Genereert een startvoedingsschema op basis van profiel.
*   **Chat History:** Houdt gespreksgeschiedenis bij (per chat) en stuurt deze naar de LLM voor context.
*   **Document Upload (PDF):** Upload PDF-documenten (min. 15 pagina's getest).
*   **Retrieval-Augmented Generation (RAG):**
    *   Documenten worden verwerkt (gesplitst, embeddings gemaakt via OpenAI).
    *   Embeddings worden opgeslagen in Supabase Vector Store (met `pgvector`).
    *   Stelt de AI in staat vragen te beantwoorden gebaseerd op de inhoud van geüploade documenten.
*   **Live Weerdata:** Integreert met OpenWeatherMap API om weersverwachtingen op te halen voor advies over buitensporten.
*   **Speech-to-Text:** Mogelijkheid om vragen in te spreken via de browser Web Speech API.
*   **Chat Management:** Opslaan van meerdere chats in LocalStorage, hernoemen en verwijderen van chats.
*   **API Key Afscherming:** Alle API keys (OpenAI, WeatherAPI, Supabase) worden veilig beheerd via een `.env` bestand en zijn niet aanwezig in de repository.
*   **Server Communicatie:** De backend server communiceert met de OpenAI API (zowel voor chat completions als embeddings) en de Supabase database.

## Technologieën

*   **Frontend:** React, react-feather, react-markdown, axios, CSS
*   **Backend:** Node.js, Express, cors, body-parser, dotenv, multer, pdf-parse
*   **AI & Data:** OpenAI API (Chat & Embeddings), LangChain (PDFLoader, TextSplitter, SupabaseVectorStore, OpenAIEmbeddings)
*   **Database:** Supabase (PostgreSQL met pgvector extensie)
*   **Externe API's:** OpenWeatherMap API
*   **Deployment:** Frontend op Netlify, Backend op Render (voorbeeld)

## Project Structuur

Alle code voor zowel de frontend als de backend bevindt zich in deze map (`chat-react`). De backend wordt gestart met `node src/server.js` (productie) of `nodemon` (development), de frontend met `react-scripts start`.

## Installatie & Setup

**Vereisten:**
*   Node.js (v18 of hoger aanbevolen)
*   npm (of yarn)
*   Git

**Stappen:**

1.  **Clone de Repository:**
    ```bash
    git clone <jouw-github-repo-url>
    cd chat-react 
    ```

2.  **Installeer Dependencies:**
    ```bash
    npm install
    ```

3.  **Maak een `.env` bestand aan:** Maak een bestand genaamd `.env` in de root van de `chat-react` map. **Voeg hierin de volgende variabelen toe met jouw eigen keys/gegevens:**

    ```dotenv
    # Verplicht: Voor OpenAI chat & embeddings
    OPENAI_API_KEY=jouw_openai_api_sleutel

    # Verplicht: Voor weerberichten
    WEATHER_API_KEY=jouw_openweathermap_api_sleutel

    # Verplicht: Voor Supabase Vector Store
    SUPABASE_URL=jouw_supabase_project_url 
    SUPABASE_ANON_KEY=jouw_supabase_anon_key 
    ```
    *   **BELANGRIJK:** Dit `.env` bestand staat correct in de `.gitignore` en wordt **niet** meegestuurd naar GitHub. Je moet dit bestand lokaal (en op de server waar je de backend host, zoals Render) zelf aanmaken en vullen.

4.  **Supabase Instellen:** Zorg dat je een Supabase project hebt aangemaakt, de `pgvector` extensie hebt geactiveerd, en de `documents` tabel en `match_documents` functie hebt aangemaakt met de SQL-scripts zoals eerder in de chat besproken.

## Lokaal Draaien

Je hebt twee terminals nodig:

1.  **Start de Backend Server:**
    ```bash
    # Zorg dat je in de chat-react map bent
    npm run server 
    ```
    (Dit gebruikt `nodemon` voor automatisch herstarten bij wijzigingen). De server draait standaard op poort 8060.

2.  **Start de Frontend Client:**
    ```bash
    # Zorg dat je in de chat-react map bent
    npm run start 
    ```
    De React app opent meestal automatisch in je browser op `http://localhost:3000`.

## Deployment

*   **Backend:** Gedployed als "Web Service" op Render (of een vergelijkbare Node.js hoster). De Environment Variables (API keys, etc.) moeten daar worden ingesteld. Het `start` commando in `package.json` (`node src/server.js`) wordt gebruikt. CORS moet de Netlify URL toestaan.
*   **Frontend:** Gedployed als "Static Site" op Netlify. Het build commando is `npm run build` en de publish directory is `build`. De environment variable `REACT_APP_API_URL` moet op Netlify worden ingesteld met de live URL van de backend (bv. `https://jouw-backend.onrender.com`).

## Bekende Issues / Beperkingen

*   **Weer Follow-up Vragen:** Simpele follow-up vragen over het weer (bv. "en in Utrecht?") worden door de AI beantwoord op basis van algemene kennis en de instructie in de systeemprompt, niet op basis van een nieuwe live API call naar de backend voor die specifieke locatie.
*   **RAG Nauwkeurigheid:** De kwaliteit van de antwoorden op basis van documenten hangt sterk af van de kwaliteit van het document, hoe de tekst is opgesplitst (chunking), en hoe de vraag wordt gesteld. Soms wordt mogelijk niet de meest relevante context gevonden of gebruikt.
*   **API Limieten:** Gebruik van API's (OpenAI, OpenWeatherMap) is onderhevig aan de limieten van de (gratis) abonnementen.
*   **Hosting (Gratis Tier):** Gratis tiers van Render kunnen de backend laten "slapen" na inactiviteit, wat leidt tot een langere laadtijd bij het eerste verzoek.
*   **Speech Recognition:** Werkt mogelijk niet in alle browsers of vereist expliciete toestemming.
*   **Error Handling:** Kan verder worden uitgebreid voor robuustheid.

---

Dit README bestand beschrijft de client/server structuur, bevat installatie-instructies, benoemt issues, bevestigt dat API keys in `.env` staan en dat de server communiceert met OpenAI.
