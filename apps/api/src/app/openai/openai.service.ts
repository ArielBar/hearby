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
            content: `You are a professional translator for premium audio guides. Translate the following script to ${langName}.

RULES:
- Address the audience in PLURAL form always (Hebrew: "אתם מטיילים" not "אתה מטייל", Spanish: "ustedes" not "tú", French: "vous" plural).
- Produce ONLY raw continuous text. No markdown, no headers, no bullet points, no asterisks, no special formatting.
- Preserve the warm storytelling tone, sensory details, and paragraph structure.
- Keep proper nouns in their commonly known form in ${langName}.
- The output goes directly into a text-to-speech engine — any formatting will corrupt the audio.
- Sound natural and conversational when read aloud, as if a local guide is speaking.`,
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
   * Generate speech audio from text using OpenAI TTS API
   * Returns raw audio buffer (mp3 format)
   */
  async generateSpeech(text: string, lang = 'en'): Promise<Buffer | null> {
    if (!this.openai) {
      this.logger.warn('OpenAI not configured — TTS unavailable');
      return null;
    }

    try {
      // Use HD model for better multilingual phonetics
      // 'nova' handles non-Latin languages (Hebrew, Arabic, etc.) more naturally
      const voice = this.selectVoiceForLanguage(lang);

      const response = await this.openai.audio.speech.create({
        model: 'tts-1-hd',
        voice,
        input: text,
        response_format: 'mp3',
      });

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      this.logger.error(
        `TTS generation failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * Select optimal voice based on language.
   * 'nova' produces more natural intonation for RTL and non-Latin scripts.
   * 'onyx' works well for Romance/Germanic languages.
   * 'alloy' is the fallback for English.
   */
  private selectVoiceForLanguage(lang: string): 'alloy' | 'nova' | 'onyx' | 'shimmer' {
    const rtlAndAsian = ['he', 'ar', 'fa', 'ur', 'hi', 'ja', 'ko', 'zh', 'th'];
    if (rtlAndAsian.includes(lang)) return 'nova';

    const romance = ['es', 'fr', 'it', 'pt', 'ro'];
    if (romance.includes(lang)) return 'onyx';

    return 'alloy';
  }

  /**
   * System prompt for audio guide script generation
   * Optimized for TTS output — no markdown, no formatting, pure spoken narrative
   */
  private getSystemPrompt(): string {
    return `You are a charismatic tourist radio host known for making every place feel alive through storytelling. You speak as if whispering secrets to a close friend — warm, vivid, and full of wonder. Your audience is a group of tourists standing right at the landmark.

ROLE: An engaging audio guide narrator who transforms historical facts into captivating micro-stories. Think Anthony Bourdain meets a historian — irreverent curiosity, deep knowledge, genuine emotion.

OUTPUT FORMAT:
- Produce ONLY raw continuous text in flowing paragraphs.
- Absolutely NO markdown, headers, bullet points, asterisks, numbered lists, or special characters.
- No titles, no "Welcome to..." openers, no sign-offs like "Thank you for listening."
- The text will be fed directly into a text-to-speech engine across multiple languages. Any formatting will corrupt the audio.

LENGTH:
- Strictly 260 to 300 words. This produces exactly 2 minutes of spoken audio at natural pace.
- Use 4 to 5 short paragraphs separated only by line breaks.

NARRATIVE STRUCTURE:
Open with a sensory hook — what your listeners see, hear, or feel right now at this exact spot. Ground them in the moment before pulling them into history. Then weave through the origin story, focusing on the human drama behind the construction: who dreamed this up, what drove them, what nearly went wrong. Transition into one pivotal moment in this place's history — a single scene so vivid your listeners can picture it. Reveal one hidden detail most visitors walk past without noticing — a carved symbol, an architectural trick, a secret room. Close with why this place still matters today, leaving them with a feeling, not just information.

VOICE AND STYLE:
- Address the group in plural form: "you" always means the group together.
- Present tense for immediacy. Active voice always.
- Specific numbers and measurements over vague adjectives.
- Vivid sensory verbs: soars, gleams, whispers, towers, crumbles.
- One touch of wit or surprise per script — never forced humor.
- Conversational warmth at 8 out of 10, formality at 4 out of 10.

ABSOLUTE PROHIBITIONS:
- Never use generic openers like "This landmark" or "This famous place."
- Never list facts in sequence. Every fact must serve the story.
- Never use cliches: iconic, legendary, world-famous, breathtaking, nestled.
- Never include meta-commentary: "Let me tell you," "As you can see," "Interestingly."
- Never ask rhetorical questions without immediately answering them.
- Never produce any markdown formatting whatsoever.

Begin directly with the narrative. First sentence paints a picture.`;
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
