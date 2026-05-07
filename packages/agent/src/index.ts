import Groq from 'groq-sdk';

export class OpenClawAgent {
  private memory: any[] = [];
  private groq: Groq | null = null;
  
  constructor() {
    console.log("OpenClaw Agent initialized with Groq backend.");
    if (process.env.GROQ_API_KEY) {
      this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    } else {
      console.warn("⚠️ GROQ_API_KEY is missing in .env!");
    }
  }
  
  async observe(context: string) {
    this.memory.push({ role: 'system', content: `Observed: ${context}` });
  }

  getMemoryLength() {
    return this.memory.length;
  }

  async plan() {
    // Get the most recent observation
    const lastObservation = this.memory[this.memory.length - 1]?.content || "";
    
    // Extract payload from observation
    const payloadMatch = lastObservation.match(/Payload: (.*)/s);
    const contentToSummarize = payloadMatch ? payloadMatch[1] : lastObservation;

    if (!this.groq) {
      return `[OFFLINE MODE] Basic Summary:\n${contentToSummarize.substring(0, 300)}...`;
    }

    try {
      const prompt = `Please provide a concise and highly informative summary of the following webpage content:\n\n${contentToSummarize.substring(0, 8000)}`;
      
      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
      });
      
      return completion.choices[0]?.message?.content || "";
    } catch (err: any) {
      console.error("Groq AI Error:", err.message);
      return `[Simulated AI Summary - API Error]\nError details: ${err.message}\nDetected key topics in the context. The user is attempting to perform an action related to the active tab. Proceeding with simulated execution to keep the agent alive.`;
    }
  }

  async generateLiveQuestions() {
    if (!this.groq) return ["Is there anything else you'd like to discuss?"];
    try {
      const recentMemory = this.memory.slice(-20).map(m => m.content).join('\n');
      
      const prompt = `Based on the following recent conversation transcript, perform a deep live analysis. Provide 3-4 extensive, insightful analytical points or questions that identify key themes, underlying issues, or critical next steps. If no ambiguities exist or it's just silence, return an empty JSON array []. Otherwise return a JSON array of strings: ["extensive point 1", "extensive point 2", ...]. Ensure your output is EXACTLY valid JSON, with no other text or markdown.\n\nTranscript:\n${recentMemory}`;
      
      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
      });
      
      const text = completion.choices[0]?.message?.content || "";
      const match = text.match(/\[.*\]/s);
      if (match) {
        return JSON.parse(match[0]);
      }
      return [];
    } catch (err) {
      console.error("Live Questions Error:", err);
      // Mock fallback questions
      return [
        "What are the core underlying assumptions we are making about the next milestone timeline?",
        "How can we strategically mitigate the blockers identified today to ensure smooth delivery?"
      ];
    }
  }

  async extractTasks() {
    if (!this.groq) return [];
    try {
      const fullMemory = this.memory.map(m => m.content).join('\n');
      
      const prompt = `Analyze the following meeting transcript and extract all actionable tasks for the individuals involved. Be comprehensive and extract more items than usual. For each task, provide a one-sentence header (title). You MUST order the tasks strictly by priority: High first, then Medium, then Low. Output a JSON array of objects with the structure: [{ "header": "One-sentence summary", "task": "Detailed description of the task", "priority": "High|Medium|Low", "deadline": "string or null" }]. If no tasks, return []. Ensure your output is EXACTLY valid JSON, with no other text or markdown.\n\nTranscript:\n${fullMemory}`;
      
      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
      });
      
      const text = completion.choices[0]?.message?.content || "";
      const match = text.match(/\[.*\]/s);
      if (match) {
        return JSON.parse(match[0]);
      }
      return [];
    } catch (err) {
      console.error("Task Extraction Error:", err);
      // Return empty — no stale data on fresh sessions
      return [];
    }
  }

  reset() {
    this.memory = [];
    console.log("Agent memory cleared.");
  }
}
