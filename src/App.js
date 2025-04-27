import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import ReactMarkdown from 'react-markdown';
import AppLogo from './logo.png';
import CGLogo from './apple.png';
// Import placeholder images (vervang paden door je eigen afbeeldingen)
import EctoImage from './images/ectomorph.png';
import MesoImage from './images/mesomorph.png';
import EndoImage from './images/endomorph.png';
// Importeer iconen (bijvoorbeeld van react-feather)
import { Edit2, Trash2, Mic, MicOff, Send, Paperclip, UploadCloud } from 'react-feather';
import './App.css';

// Functie om chats uit localStorage te laden
const loadChatsFromLocalStorage = () => {
  const savedChats = localStorage.getItem('aiCoachChats');
  return savedChats ? JSON.parse(savedChats) : [];
};

// Functie om chats op te slaan in localStorage
const saveChatsToLocalStorage = (chats) => {
  localStorage.setItem('aiCoachChats', JSON.stringify(chats));
};

// Check for browser support for SpeechRecognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

if (recognition) {
  recognition.continuous = false; // Stop listening when user stops speaking
  recognition.lang = 'nl-NL'; // Set language to Dutch
  recognition.interimResults = true; // Show interim results
}

function App() {
  // --- State Management Refactor ---
  const [allChats, setAllChats] = useState(loadChatsFromLocalStorage()); // Lijst met alle chats
  const [currentChatId, setCurrentChatId] = useState(null); // ID van de actieve chat

  // Huidige chat data (afgeleid van allChats en currentChatId)
  const currentChat = allChats.find(chat => chat.id === currentChatId);
  const chatHistory = currentChat ? currentChat.history : [];
  const userInfo = currentChat ? currentChat.userInfo : {};

  // Stap state (bepaalt of info form of chat getoond wordt)
  // Wordt nu bepaald door of er een currentChatId is
  const step = currentChatId ? 'chat' : 'info'; 

  // State voor het info formulier (alleen nodig als er GEEN chat actief is)
  const [gewicht, setGewicht] = useState('');
  const [lengte, setLengte] = useState('');
  const [bodytype, setBodytype] = useState('');
  const [timeline, setTimeline] = useState(6);
  const [focus, setFocus] = useState('');
  const [streefgewicht, setStreefgewicht] = useState('');

  // State voor de chat input
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const chatFileInputRef = useRef(null);
  const [selectedChatFile, setSelectedChatFile] = useState(null);
  
  // Ref for scrolling to bottom
  const messagesEndRef = useRef(null);

  // --- Speech Recognition State ---
  const [isListening, setIsListening] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef(recognition); // Use ref to hold the recognition instance

  // --- State voor Document Upload ---
  const [selectedDocFile, setSelectedDocFile] = useState(null);
  const [docUploadStatus, setDocUploadStatus] = useState(''); // Voor feedback
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const docFileInputRef = useRef(null); // Ref voor de document input

  // Effect om allChats op te slaan wanneer het verandert
  useEffect(() => {
    saveChatsToLocalStorage(allChats);
  }, [allChats]);

  // Effect to scroll to bottom when chat history updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]); // Dependency: chatHistory of the current chat

  // Helper functie om slider waarde om te zetten naar tekst
  const formatTimeline = (months) => {
    if (months === 0) return "Onbepaald / Geen haast";
    if (months === 1) return "1 Maand";
    if (months === 12) return "1 Jaar";
    return `${months} Maanden`;
  };

  // Functie om een chat bij te werken (voegt bericht toe aan history)
  const updateChatHistory = (chatId, newMessage) => {
    setAllChats(prevAllChats => {
      return prevAllChats.map(chat => {
        if (chat.id === chatId) {
          // Zorg dat we keys uniek maken indien nodig (bv. voor loading)
          const key = newMessage.key || `${chat.history.length}-${Date.now()}`;
          return { ...chat, history: [...chat.history, {...newMessage, key}] };
        }
        return chat;
      });
    });
  };
  
  // Functie om laadbericht te vervangen door echt bericht/error
   const replaceLoadingMessage = (chatId, keyToReplace, finalMessage) => {
      setAllChats(prevAllChats => {
         return prevAllChats.map(chat => {
           if (chat.id === chatId) {
             return {
               ...chat,
               history: chat.history.map(msg => 
                 msg.key === keyToReplace ? { ...finalMessage, key: msg.key } : msg
               )
             };
           }
           return chat;
         });
       });
   };

  const fetchInitialPlan = (chatIdToUpdate, userInfoForPlan) => {
    setLoading(true);
    const loadingKey = `loading-plan-${chatIdToUpdate}`;
    const generatingMessage = { role: 'ai', content: 'Voedingsschema wordt gegenereerd...', key: loadingKey };
    // Voeg laadbericht toe aan de specifieke chat
    updateChatHistory(chatIdToUpdate, generatingMessage);

    // Voorbereiden van de data als een normaal JavaScript object
    const requestData = {
      prompt: "ACTION:GENERATE_INITIAL_PLAN",
      userProfile: JSON.stringify(userInfoForPlan), // Gebruik parameter
      chatHistory: JSON.stringify([]) // Stuur lege geschiedenis voor initieel plan
    };

    // Verstuur als JSON - Dit deel wordt aangepast
    axios.post('http://localhost:8060/chat', requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
      .then((res) => {
        const planMessage = { role: 'ai', content: res.data, key: Date.now() }; // Geef unieke key
        replaceLoadingMessage(chatIdToUpdate, loadingKey, planMessage);
      })
      .catch(function (error) {
        console.error("API Error generating plan:", error);
        const errorMessage = { role: 'ai', content: `Error: Kon het startplan niet genereren. (${error.message || 'Serverfout'})`, key: Date.now() }; // Geef unieke key
        replaceLoadingMessage(chatIdToUpdate, loadingKey, errorMessage);
      })
      .finally(() => { setLoading(false); });
  };

  const handleInfoSubmit = (e) => {
    e.preventDefault();
    if (!gewicht || !lengte || !bodytype || !timeline || !focus || !streefgewicht) {
      alert('Vul alle velden in.'); return;
    }
    
    const newChatId = Date.now().toString(); // Simpel uniek ID
    const formattedTimeline = formatTimeline(parseInt(timeline, 10));
    const submittedInfo = {
      gewicht: `${gewicht} kg`,
      lengte: `${lengte} cm`,
      bodytype,
      timeline: formattedTimeline,
      focus,
      streefgewicht: `${streefgewicht} kg`
    };
    
    // Maak het initiële welkomstbericht (wordt later vervangen door plan)
    const initialMessage = { role: 'ai', content: `Oké, ik heb je gegevens... Ik genereer nu je startplan!`, key: `init-${newChatId}` };
    
    const newChat = {
      id: newChatId,
      title: `Chat ${new Date().toLocaleString()}`, // Simpele titel
      userInfo: submittedInfo,
      history: [initialMessage] // Begin met alleen het bericht
    };

    setAllChats(prev => [...prev, newChat]);
    setCurrentChatId(newChatId);
    // Reset form fields for next time
    setGewicht(''); setLengte(''); setBodytype(''); setTimeline(6); setFocus(''); setStreefgewicht('');
    
    fetchInitialPlan(newChatId, submittedInfo); // Roep plan generatie aan
  };

  // --- Speech Recognition Logic ---
  useEffect(() => {
    if (!recognitionRef.current) return;

    const rec = recognitionRef.current;

    rec.onresult = (event) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setFinalTranscript(prev => prev + final); // Append final results
      setInterimTranscript(interim);
      // Update main prompt immediately with final transcript part
      if (final) {
         setPrompt(prevPrompt => prevPrompt + final); 
      }
    };

    rec.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    rec.onend = () => {
      setIsListening(false);
      setInterimTranscript(''); // Clear interim when listening stops
      setFinalTranscript(''); // Clear final transcript buffer
    };

    // Clean up listeners when component unmounts
    return () => {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        if (isListening) {
            rec.stop();
        }
    };
  }, [isListening]); // Depend on isListening to manage cleanup

  const toggleListening = () => {
    if (!recognitionRef.current) {
        alert("Speech recognition wordt niet ondersteund door deze browser.");
        return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setPrompt(''); // Clear prompt when starting new dictation
      setFinalTranscript(''); // Clear final transcript buffer
      setInterimTranscript(''); // Clear interim transcript
      recognitionRef.current.start();
      setIsListening(true);
    }
  };
  // --- End Speech Recognition Logic ---

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (loading || !prompt.trim()) return;

    const currentChat = allChats.find(chat => chat.id === currentChatId);
    if (!currentChat) {
        console.error("Geen actieve chat gevonden");
        return;
    }

    const userMessage = { role: 'user', content: prompt, key: Date.now() };
    const aiPlaceholderKey = Date.now() + 1;
    const aiPlaceholderMessage = { role: 'ai', content: '', key: aiPlaceholderKey }; // Start with empty content
    
    // Add user message and AI placeholder to history immediately
    updateChatHistory(currentChatId, userMessage);
    updateChatHistory(currentChatId, aiPlaceholderMessage);

    setLoading(true);
    const currentPrompt = prompt;
    const fileToSend = selectedChatFile;
    setPrompt(""); // Clear input
    setSelectedChatFile(null);
    if (chatFileInputRef.current) {
        chatFileInputRef.current.value = "";
    }

    // Prepare data (using FormData for file handling)
    const formData = new FormData();
    formData.append('prompt', currentPrompt);
    formData.append('userProfile', JSON.stringify(currentChat.userInfo || {})); 
    formData.append('chatHistory', JSON.stringify(currentChat.history)); // Send history *before* placeholder
    if (fileToSend) {
      formData.append('chatFile', fileToSend);
    }

    try {
        const response = await fetch("http://localhost:8060/chat", { // Use fetch
            method: 'POST',
            body: formData, // Send FormData
            // Headers are set automatically by fetch for FormData
        });

        if (!response.ok) {
            // Handle HTTP errors (e.g., 500)
            const errorText = await response.text();
            throw new Error(errorText || `Server error: ${response.status}`);
        }

        // Process the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamingContent = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            streamingContent += chunk;
            
            // Update the placeholder message content dynamically
            setAllChats(prevAllChats => prevAllChats.map(chat => {
                if (chat.id === currentChatId) {
                    return {
                        ...chat,
                        history: chat.history.map(msg => 
                            msg.key === aiPlaceholderKey 
                            ? { ...msg, content: streamingContent } 
                            : msg
                        )
                    };
                }
                return chat;
            }));
        }

    } catch (error) {
      console.error("API Error or streaming error:", error);
      // Update placeholder with error message
      setAllChats(prevAllChats => prevAllChats.map(chat => {
          if (chat.id === currentChatId) {
              return {
                  ...chat,
                  history: chat.history.map(msg => 
                      msg.key === aiPlaceholderKey 
                      ? { ...msg, content: `Error: ${error.message || 'Kon geen antwoord streamen.'}` } 
                      : msg
                  )
              };
          }
          return chat;
      }));
    } finally {
      setLoading(false);
    }
  };

  const handleChatFileChange = (event) => {
    if (event.target.files && event.target.files[0]) {
      setSelectedChatFile(event.target.files[0]);
      // Optioneel: stuur direct met een standaard prompt?
      // setPrompt(`Analyseer het bijgevoegde bestand: ${event.target.files[0].name}`);
      // handleChatSubmit(new Event('submit')); // Trigger submit 
    } else {
        setSelectedChatFile(null);
    }
  };

  // --- Document Upload Functie ---
  const handleDocumentFileChange = (event) => {
    if (event.target.files && event.target.files[0]) {
      setSelectedDocFile(event.target.files[0]);
      // Start upload direct na selectie
      uploadDocument(event.target.files[0]);
    } else {
        setSelectedDocFile(null);
    }
     // Reset de input zodat dezelfde file opnieuw geselecteerd kan worden
     if (docFileInputRef.current) {
        docFileInputRef.current.value = "";
     } 
  };

  const uploadDocument = async (fileToUpload) => {
    if (!fileToUpload) return;

    setIsUploadingDoc(true);
    setDocUploadStatus(`Bezig met uploaden: ${fileToUpload.name}...`);

    const formData = new FormData();
    formData.append('documentFile', fileToUpload); // Key moet matchen met backend!

    try {
        const response = await fetch("http://localhost:8060/upload-document", {
            method: 'POST',
            body: formData,
        });

        const responseText = await response.text(); // Lees altijd de text response

        if (!response.ok) {
            throw new Error(responseText || `Serverfout: ${response.status}`);
        }
        
        setDocUploadStatus(responseText); // Toon succesbericht van server
        setSelectedDocFile(null); // Reset selectie na succes

    } catch (error) {
        console.error("Fout bij uploaden document:", error);
        setDocUploadStatus(`Upload mislukt: ${error.message}`);
    } finally {
        setIsUploadingDoc(false);
        // Laat statusbericht even staan of reset na timeout?
        // setTimeout(() => setDocUploadStatus(''), 5000); // Optioneel: reset na 5 sec
    }
  };
  // --- Einde Document Upload Functie ---

  // Functie om een chat te hernoemen
  const renameChat = (chatId) => {
    const chatToRename = allChats.find(chat => chat.id === chatId);
    if (!chatToRename) return;

    const newTitle = window.prompt("Voer een nieuwe titel in voor deze chat:", chatToRename.title);
    if (newTitle && newTitle.trim() !== "") {
      setAllChats(prevAllChats => 
        prevAllChats.map(chat => 
          chat.id === chatId ? { ...chat, title: newTitle.trim() } : chat
        )
      );
    }
  };

  // Functie om een chat te verwijderen
  const deleteChat = (chatIdToDelete) => {
    if (!window.confirm("Weet je zeker dat je deze chat wilt verwijderen?")) {
      return; // Gebruiker annuleert
    }

    setAllChats(prevAllChats => prevAllChats.filter(chat => chat.id !== chatIdToDelete));

    // Als de huidige chat is verwijderd, ga terug naar de info/start staat
    if (currentChatId === chatIdToDelete) {
      setCurrentChatId(null);
    }
  };

  // Functie om een chat te selecteren vanuit de sidebar
  const selectChat = (chatId) => {
    // Voorkom dat klikken op de knoppen de chat selecteert
    if (currentChatId !== chatId) { 
      setCurrentChatId(chatId);
      // Reset prompt en file selectie bij wisselen
      setPrompt('');
      setSelectedChatFile(null);
      if (chatFileInputRef.current) {
        chatFileInputRef.current.value = "";
      }
    }
  };

  // Functie om een nieuwe chat te starten
  const startNewChat = () => {
    setCurrentChatId(null); // Dit zet de 'step' automatisch naar 'info'
    // Reset info form fields (optioneel, kan ook bij submit blijven)
    setGewicht(''); setLengte(''); setBodytype(''); setTimeline(6); setFocus(''); setStreefgewicht('');
  };

  return (
    <div className="main-layout">
      {/* --- Sidebar --- */}
      <div className="sidebar">
        <img src={AppLogo} alt="" className="app-logo sidebar-logo" />
        <button onClick={startNewChat} className="new-chat-button">Nieuwe Chat</button>
        
        {/* --- Document Upload Sectie --- */}
        <div className="document-upload-section">
            <label htmlFor="doc-upload-input" className={`document-upload-button ${isUploadingDoc ? 'uploading' : ''}`} title="Upload PDF document voor RAG">
                <UploadCloud size={18} />
                <span>{isUploadingDoc ? 'Bezig...' : 'Document Uploaden'}</span>
            </label>
             <input 
                id="doc-upload-input"
                type="file" 
                accept=".pdf" // Accepteer alleen PDF
                ref={docFileInputRef}
                onChange={handleDocumentFileChange} 
                disabled={isUploadingDoc}
                style={{ display: 'none' }} 
            />
            {docUploadStatus && <div className="upload-status-message">{docUploadStatus}</div>}
        </div>
        {/* --- Einde Document Upload Sectie --- */}

        <ul className="chat-list">
          {allChats.map(chat => (
            <li 
              key={chat.id} 
              className={`chat-list-item ${chat.id === currentChatId ? 'active' : ''}`}
              // Verwijder onClick van li, gebruik div voor selectie
            >
              <div className="chat-title-area" onClick={() => selectChat(chat.id)}>
                 {chat.title || `Chat ${chat.id}`}
              </div>
              <div className="chat-actions">
                  <button 
                      className="chat-action-button rename-button"
                      onClick={(e) => { e.stopPropagation(); renameChat(chat.id); }} 
                      title="Hernoem chat"
                  >
                      <Edit2 size={14} />
                  </button>
                  <button 
                      className="chat-action-button delete-button"
                      onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }} 
                      title="Verwijder chat"
                  >
                      <Trash2 size={14} />
                  </button>
              </div>
            </li>
          ))}
          {allChats.length === 0 && <li className="no-chats">Geen eerdere chats.</li>}
        </ul>
      </div>

      {/* --- Hoofd Chat Gebied --- */}
      <div className="chat-area">

        {/* Conditionally render Chat Content OR Info Form */}
        {step === 'info' && (
          <div className="info-form-container">
            <h2>Vertel ons over jezelf</h2>
            <form onSubmit={handleInfoSubmit}>
              {/* Gewicht, Lengte & Streefgewicht Inputs */}
              <div className="user-info-inputs triple-inputs">
                <div className="input-group">
                  <label htmlFor="gewicht">Huidig Gewicht (kg)</label>
                  <input type="number" id="gewicht" value={gewicht} onChange={(e) => setGewicht(e.target.value)} placeholder="bv. 75" required />
                </div>
                <div className="input-group">
                  <label htmlFor="lengte">Lengte (cm)</label>
                  <input type="number" id="lengte" value={lengte} onChange={(e) => setLengte(e.target.value)} placeholder="bv. 180" required />
                </div>
                {/* Nieuw Streefgewicht Input */}
                <div className="input-group">
                  <label htmlFor="streefgewicht">Streefgewicht (kg)</label>
                  <input type="number" id="streefgewicht" value={streefgewicht} onChange={(e) => setStreefgewicht(e.target.value)} placeholder="bv. 70" required />
                </div>
              </div>

              {/* Bodytype Selectie met afbeeldingen */}
              <div className="bodytype-selection">
                <label>Bodytype</label>
                <div className="bodytype-options">
                  {[ { type: 'ectomorph', img: EctoImage, label: 'Ectomorph' },
                     { type: 'mesomorph', img: MesoImage, label: 'Mesomorph' },
                     { type: 'endomorph', img: EndoImage, label: 'Endomorph' } ].map(option => (
                    <div key={option.type} className="bodytype-option">
                      <input 
                        type="radio" 
                        id={option.type}
                        name="bodytype"
                        value={option.type}
                        checked={bodytype === option.type}
                        onChange={(e) => setBodytype(e.target.value)} 
                        required
                      />
                      <label htmlFor={option.type} className="bodytype-label">
                        <img src={option.img} alt={option.label} />
                        <span>{option.label}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Tijdlijn Slider en Focus Dropdown */}
              <div className="user-info-inputs dual-inputs"> {/* Nieuwe class voor styling */} 
                {/* Vervang Tijdlijn Dropdown door Slider */}
                <div className="input-group slider-group">
                   <label htmlFor="timeline">Tijdlijn Streefgewicht: <span>{formatTimeline(parseInt(timeline, 10))}</span></label>
                   <input 
                     type="range" 
                     id="timeline" 
                     min="0" 
                     max="12" 
                     step="1" 
                     value={timeline} 
                     onChange={(e) => setTimeline(e.target.value)} 
                     required 
                   />
                   <div className="slider-labels">
                      <span>0m</span>
                      <span>6m</span>
                      <span>12m</span>
                   </div>
                </div>
                {/* Focus Dropdown blijft */}
                <div className="input-group">
                  <label htmlFor="focus">Focus</label>
                  <select id="focus" value={focus} onChange={(e) => setFocus(e.target.value)} required>
                     <option value="" disabled>Kies je focus...</option>
                     <option value="Spieropbouw">Spieropbouw</option>
                     <option value="Vetverlies">Vetverlies</option>
                     <option value="Algemene Fitness">Algemene Fitness</option>
                     <option value="Uithoudingsvermogen">Uithoudingsvermogen</option>
                   </select>
                </div>
              </div>
              
              <button type="submit" className="start-chat-button">Start Chat</button>
            </form>
          </div>
        )}

        {step === 'chat' && currentChat && (
          <>
             {/* Chat Wrapper contains only the messages now */}
            <div className="chat-wrapper">
                <div className="chat-container">
                {chatHistory.map((message, index) => (
                    // Outer div handles the message bubble style (.message + .user/.ai)
                    <div key={message.key || index} className={`message ${message.role === 'user' ? 'user' : 'ai'}`}>
                        {/* Inner div handles markdown styling */}
                        <div className="markdown-content">
                            <ReactMarkdown>
                                {message.content}
                            </ReactMarkdown>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} /> {/* Scroll anchor */}
                </div>
            </div>
            
            {/* Input form is now outside chat-wrapper, but inside chat-area and conditional render */}
            <form onSubmit={handleChatSubmit} className="input-form">
                <div className="input-area-wrapper">
                    <textarea
                        value={prompt + interimTranscript} // Show interim results while listening
                        onChange={(e) => {
                            if (!isListening) { // Only allow manual typing if not listening
                                setPrompt(e.target.value)
                            }
                        }}
                        placeholder="Stel je vraag of type hier..." 
                        rows="2"
                        disabled={loading || isListening} // Disable typing while listening
                    />
                    {/* Speech Recognition Button */}
                    {recognition && (
                        <button 
                            type="button" 
                            onClick={toggleListening} 
                            className={`mic-button ${isListening ? 'listening' : ''}`}
                            disabled={loading} 
                            title={isListening ? "Stop met luisteren" : "Start met inspreken"}
                        >
                            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                        </button>
                    )}
                    {/* File Upload Button */}
                    <label className="file-upload-button" title="Bestand bijvoegen">
                        <Paperclip size={20} />
                        <input 
                            type="file" 
                            ref={chatFileInputRef}
                            onChange={handleChatFileChange} 
                            disabled={loading}
                            style={{ display: 'none' }} 
                        />
                    </label>
                    {/* Send Button */}    
                    <button type="submit" disabled={loading || !prompt.trim()} title="Verstuur">
                        <Send size={20} />
                    </button>
                </div>
                {selectedChatFile && <div className="selected-file-name">Bestand: {selectedChatFile.name}</div>}
            </form>
          </>
        )}
        
        {/* Footer remains at the bottom of chat-area */}
        <footer className="footer">
          ~ AIcoach ~
        </footer>
      </div>
    </div>
  );
}

export default App;
