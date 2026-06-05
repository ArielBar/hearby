import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface AudioScript {
  name: string;
  masterScript: string;
}

/**
 * OpenAI Service - Generates professional audio guide scripts
 *
 * Uses GPT-4o-mini for cost-effective, high-quality script generation.
 * All scripts are cached for 7 days based on POI name.
 */
@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY not configured. OpenAI features will be disabled.',
      );
    }

    this.openai = new OpenAI({
      apiKey: apiKey || 'dummy-key',
    });

    // Use gpt-4o-mini for cost-effective generation (cheaper than gpt-4o)
    this.model =
      this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';

    this.logger.log(`OpenAI Service initialized with model: ${this.model}`);
  }

  /**
   * Generate a captivating audio guide script for a tourist landmark
   *
   * Strategy:
   * 1. Check cache for existing script (7-day TTL)
   * 2. If not cached, generate new script using OpenAI
   * 3. Cache the result for 7 days
   *
   * @param landmarkName - Official name of the tourist landmark
   * @returns Audio script in English or null if generation fails
   */
  async generateAudioScript(landmarkName: string): Promise<AudioScript | null> {
    try {
      this.logger.log(`Generating audio script for: "${landmarkName}"`);

      // Check if API key is configured
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        this.logger.error(
          'Cannot generate script: OPENAI_API_KEY not configured',
        );
        return null;
      }

      // Generate script using OpenAI
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt(),
          },
          {
            role: 'user',
            content: `Generate a captivating audio guide script for: ${landmarkName}\n\nRespond in this exact format:\nNAME: <official English name of this landmark>\nSCRIPT:\n<your script here>`,
          },
        ],
        temperature: 0.7,
        max_tokens: 600,
        presence_penalty: 0.3,
        frequency_penalty: 0.3,
      });

      const rawResponse = completion.choices[0]?.message?.content?.trim();

      if (!rawResponse) {
        this.logger.error(
          `OpenAI returned empty response for "${landmarkName}"`,
        );
        return null;
      }

      // Parse NAME and SCRIPT from response
      const nameMatch = rawResponse.match(/^NAME:\s*(.+)/m);
      const scriptMatch = rawResponse.match(/SCRIPT:\s*([\s\S]+)/);
      const englishName = nameMatch?.[1]?.trim() || landmarkName;
      const generatedScript = scriptMatch?.[1]?.trim() || rawResponse;

      // Validate script length (should be ~250-300 words for 2-minute audio)
      const wordCount = generatedScript.split(/\s+/).length;
      this.logger.debug(`Generated script: ${wordCount} words`);

      if (wordCount < 100) {
        this.logger.warn(
          `Script too short (${wordCount} words) for "${landmarkName}"`,
        );
      }

      const result: AudioScript = {
        name: englishName,
        masterScript: generatedScript,
      };

      this.logger.log(
        `Successfully generated script for "${englishName}"`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to generate audio script for "${landmarkName}"`,
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  /**
   * Translate an English audio script to the target language.
   * Preserves the audio guide tone and pacing.
   *
   * @param englishScript - The English master script
   * @param poiName - POI name (for context)
   * @param targetLang - Target language code (e.g., 'he', 'es', 'fr')
   * @returns Translated script string, or null on failure
   */
  async translateScript(
    englishScript: string,
    poiName: string,
    targetLang: string,
  ): Promise<string | null> {
    try {
      const langName = this.getLanguageName(targetLang);
      this.logger.log(`Translating script for "${poiName}" to ${langName}`);

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator specializing in tourism and audio guides. Translate the following audio guide script to ${langName}. 

IMPORTANT: Always address the audience in PLURAL form (e.g., in Hebrew use "אתם מטיילים" not "אתה מטייל", in Spanish use "ustedes" not "tú", in French use "vous" plural). The script is for a group of tourists listening together.

Preserve the engaging, storytelling tone, sensory details, and paragraph structure. Keep proper nouns (landmark names, people, places) in their commonly known form in ${langName}. The translation should sound natural when read aloud — it will be used for text-to-speech.`,
          },
          {
            role: 'user',
            content: englishScript,
          },
        ],
        temperature: 0.3, // Low temperature for accurate translation
        max_tokens: 800,
      });

      const translated = completion.choices[0]?.message?.content?.trim();

      if (!translated) {
        this.logger.warn(`Empty translation response for "${poiName}" → ${langName}`);
        return null;
      }

      this.logger.log(`✓ Translated "${poiName}" to ${langName}`);
      return translated;
    } catch (error) {
      this.logger.error(
        `Translation failed for "${poiName}" → ${targetLang}`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  /**
   * System prompt for audio guide script generation
   *
   * Optimized for:
   * - Engaging, storytelling-driven narrative
   * - 2-minute spoken audio length (~250-300 words)
   * - Professional tour guide tone
   * - Historical context + fascinating facts
   * - Always in English (master language)
   */
  private getSystemPrompt(): string {
    return `You are a world-class museum audio guide narrator with 20 years of experience captivating international tourists. Your scripts have won awards for making history come alive.

MISSION: Create an immersive 2-minute audio experience that makes tourists feel the significance of the landmark they're visiting.

STRICT REQUIREMENTS:

1. LENGTH & PACING:
   - Exactly 250-300 words (verify by counting)
   - 5 short paragraphs (3-4 sentences each)
   - Natural breathing points between paragraphs
   - Optimized for clear, conversational speech

2. NARRATIVE STRUCTURE (Follow exactly):

   PARAGRAPH 1 - THE HOOK (30-40 words):
   - Start with sensory detail: what tourists SEE/FEEL right now
   - Create immediate emotional connection
   - Address the audience as a GROUP (plural "you" = a group of tourists together)
   - Example: "As you stand in the shadow of this ancient structure, imagine the millions who stood here before you..."

   PARAGRAPH 2 - ORIGIN STORY (60-70 words):
   - When and why was it built?
   - Who commissioned/designed it?
   - What problem did it solve or symbolize?
   - Include ONE surprising fact about its construction

   PARAGRAPH 3 - DEFINING MOMENT (60-70 words):
   - ONE pivotal historical event that happened here
   - Focus on human drama, not dry dates
   - Make it visual and cinematic
   - Connect past to present

   PARAGRAPH 4 - HIDDEN DETAILS (50-60 words):
   - Point out something tourists might miss
   - Secret symbols, hidden rooms, optical illusions
   - Use phrases like "Look closely..." or "Few visitors notice..."
   - Make them feel like insiders

   PARAGRAPH 5 - EMOTIONAL CLOSE (40-50 words):
   - Why does this place matter TODAY?
   - What does it represent for humanity?
   - End with an invitation to reflect or imagine
   - Leave them feeling moved, not just informed

3. LANGUAGE STYLE:
   - Use present tense for immediacy: "stands" not "stood"
   - Active voice: "Architects designed" not "was designed"
   - Specific numbers: "324 meters tall" not "very tall"
   - Vivid verbs: "soars" "towers" "gleams" not "is"
   - Sensory details: colors, textures, sounds, scale

4. WHAT TO AVOID:
   ❌ "This landmark..." (too generic - use its name)
   ❌ Lists of facts: "It was built in X, Y happened, then Z..."
   ❌ Academic tone: "It is considered..." "Historians believe..."
   ❌ Clichés: "world-famous" "iconic" "legendary"
   ❌ Questions without answers: "What was the architect thinking?"
   ❌ Meta-commentary: "Let me tell you..." "As you can see..."

5. WHAT TO INCLUDE:
   ✅ Exact measurements (height, age, weight)
   ✅ ONE little-known fact that surprises
   ✅ ONE famous person connected to this place
   ✅ Visual details tourists can verify right now
   ✅ Emotional significance, not just historical facts

6. TONE CALIBRATION:
   - Enthusiasm: 8/10 (excited but not breathless)
   - Formality: 5/10 (professional but conversational)
   - Humor: 2/10 (light touch, never forced)
   - Emotion: 7/10 (move them without being manipulative)

CRITICAL: Begin directly with the narrative. No titles, no "Welcome to...", no preamble. First word should paint a picture.

Generate the script now.`;
  }

  private getLanguageName(code: string): string {
    const languages: Record<string, string> = {
      he: 'Hebrew',
      ar: 'Arabic',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      ru: 'Russian',
      ja: 'Japanese',
      ko: 'Korean',
      zh: 'Chinese',
      nl: 'Dutch',
      tr: 'Turkish',
      pl: 'Polish',
      sv: 'Swedish',
      th: 'Thai',
      hi: 'Hindi',
    };
    return languages[code] || code;
  }
}
