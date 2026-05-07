# ambient-ai-assistant
Ambient AI Productivity Assistant
Ambient AI is a silent, local productivity assistant that runs in the background while you attend meetings, lectures, or discussions. It listens through your microphone, transcribes speech in real-time using OpenAI Whisper, and uses Claude to automatically extract tasks, detect deadlines, generate structured notes, and suggest smart questions — all without ever joining your calls as a bot.
Unlike traditional meeting assistants, Ambient AI never appears as a participant. It works entirely through passive local audio capture, keeping your meetings natural and your workflow uninterrupted.
What it does:

Transcribes conversations in real-time using Whisper running locally on your machine
Extracts tasks, decisions, deadlines, and action items automatically from speech
Classifies tasks by priority — high, medium, or low — based on urgency and context
Suggests 2 to 3 intelligent clarifying questions during conversations to help you engage better
Schedules detected tasks into your calendar by finding free slots and avoiding conflicts
Generates structured meeting notes including a summary, key points, and action items
Supports a hybrid workflow where the AI suggests and the user approves before anything is executed

Tech stack:
Built with Python and FastAPI on the backend, React on the frontend, Whisper for speech-to-text, and Claude 3.5 Sonnet for language understanding. The frontend and backend communicate over WebSockets for real-time updates. The system can optionally run fully offline using Whisper and a local LLM like Mistral 7B via Ollama.
Privacy first:
Audio never leaves your machine. Only transcribed text is sent to the LLM API. No recordings are stored unless you explicitly export your 
