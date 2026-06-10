import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as Sentry from '@sentry/nestjs';

export interface TranslationResult {
  translatedName: string;
  translatedScript: string;
}

export interface AudioScript {
  name: string;
  masterScript: string;
}

/**
 * OpenAI model pricing per 1M tokens (USD).
 * Update when switching models or when pricing changes.
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
};

/** TTS pricing per 1M characters */
const TTS_PRICING: Record<string, number> = {
  'tts-1': 15.00,
  'tts-1-hd': 30.00,
};

/**
 * Tourist Fact Selection Engine — System Prompt
 *
 * Lightweight pre-filter that extracts and ranks the most valuable tourist facts.
 * Designed for minimal token usage while maximizing informational density.
 */
const FACT_SELECTION_PROMPT = `You are a Tourist Fact Selection Engine. Your job is to select the 5 most valuable facts about a Point of Interest for a 2-minute audio guide.

SCORING CRITERIA (implicit, do not output scores):
- Surprise: How unexpected is this fact?
- Visual: Can the visitor see or sense it on-site?
- Memorability: Would a tourist repeat this to someone later?
- Uniqueness: Is this rare or specific to this location?
- Story potential: Does it imply human drama, conflict, or mystery?
- Meaning: Does it change how the place is understood?
- Local guide value: Would a knowledgeable guide mention it?

RULES:
- Output EXACTLY 5 facts, ranked by tourist value (best first)
- Each fact: max 1-2 sentences, concrete, specific
- Include at least 1 visual/sensory fact (something visible on-site)
- Include at least 1 surprising/lesser-known fact
- Include at least 1 fact with story/human drama potential
- NO generic facts (e.g., "it's very popular with tourists")
- NO opinions or subjective claims
- NO expanded explanations or narrative
- Prefer specific numbers, dates, names over vague descriptions

OUTPUT FORMAT (strict):
1. [fact]
2. [fact]
3. [fact]
4. [fact]
5. [fact]`;

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

  constructor(private readonly configService: ConfigService) {
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
   * Uses a two-step pipeline:
   *   1. Fact Selection Engine — lightweight call to extract & rank top tourist facts
   *   2. Storytelling — focused narrative using only the curated facts
   *
   * @param landmarkName - Official name of the tourist landmark
   * @param lang - Target language code (default: 'en'). When non-English, generates directly in that language.
   * @returns Audio script or null if generation fails
   */
  async generateAudioScript(
    landmarkName: string,
    lang = 'en',
  ): Promise<AudioScript | null> {
    try {
      const langName = lang !== 'en' ? this.getLanguageName(lang) : null;
      this.logger.log(
        `Generating audio script for: "${landmarkName}"${langName ? ` (${langName})` : ''}`,
      );

      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        this.logger.error('Cannot generate script: OPENAI_API_KEY not configured');
        return null;
      }

      // Step 1: Fact Selection (lightweight, low-token call)
      const facts = await this.selectTouristFacts(landmarkName);
      if (!facts) {
        this.logger.warn(`Fact selection returned nothing for "${landmarkName}"`);
        return null;
      }

      this.logger.debug(`Selected ${facts.split('\n').filter(l => l.trim()).length} facts for "${landmarkName}"`);

      // Step 2: Storytelling from curated facts
      const languageInstruction = langName
        ? `\n\nIMPORTANT: Write the entire script in ${langName}. The NAME should be the commonly known name in ${langName}. Address the audience in PLURAL form (e.g., Hebrew: "אתם" not "אתה").`
        : '';

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt() + languageInstruction,
          },
          {
            role: 'user',
            content: `Generate a captivating audio guide script for: ${landmarkName}\n\nUse ONLY these curated facts as your source material:\n${facts}\n\nWeave these facts into a compelling 2-minute narrative. Do not add facts beyond what is provided.\n\nRespond in this exact format:\nNAME: <official${langName ? ` ${langName}` : ' English'} name of this landmark>\nSCRIPT:\n<your script here>`,
          },
        ],
        temperature: 0.7,
        max_tokens: 800,
        presence_penalty: 0.3,
        frequency_penalty: 0.3,
      });

      const rawResponse = completion.choices[0]?.message?.content?.trim();
      this.trackOpenAICost(completion.usage ?? undefined, this.model, 'storytelling', landmarkName);

      if (!rawResponse) {
        this.logger.error(`OpenAI returned empty response for "${landmarkName}"`);
        return null;
      }

      // Parse NAME and SCRIPT from response
      const nameMatch = rawResponse.match(/^NAME:\s*(.+)/m);
      const scriptMatch = rawResponse.match(/SCRIPT:\s*([\s\S]+)/);
      const name = nameMatch?.[1]?.trim() || landmarkName;
      const generatedScript = scriptMatch?.[1]?.trim() || rawResponse;

      const wordCount = generatedScript.split(/\s+/).length;
      this.logger.debug(`Generated script: ${wordCount} words`);

      if (wordCount < 50) {
        this.logger.warn(`Script too short (${wordCount} words) for "${landmarkName}"`);
      }

      this.logger.log(
        `Successfully generated script for "${name}"${langName ? ` (${langName})` : ''}`,
      );

      return { name, masterScript: generatedScript };
    } catch (error) {
      this.logger.error(
        `Failed to generate audio script for "${landmarkName}"`,
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  /**
   * Tourist Fact Selection Engine
   *
   * Lightweight LLM call that extracts and ranks the most valuable tourist facts.
   * Optimized for minimal token usage — outputs only compact, ranked facts.
   *
   * Selection criteria (scored 1–10):
   * - Surprise value, Visual relevance, Memorability
   * - Uniqueness, Story potential, Meaning, Local guide value
   *
   * @returns Ranked list of top 5 facts (compact text), or null on failure
   */
  private async selectTouristFacts(landmarkName: string): Promise<string | null> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: FACT_SELECTION_PROMPT,
          },
          {
            role: 'user',
            content: `POI: ${landmarkName}`,
          },
        ],
        temperature: 0.4,
        max_tokens: 400,
      });

      this.trackOpenAICost(completion.usage ?? undefined, this.model, 'fact_selection', landmarkName);
      return completion.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      this.logger.error(
        `Fact selection failed for "${landmarkName}"`,
        error instanceof Error ? error.message : error,
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
  ): Promise<TranslationResult | null> {
    try {
      const langName = this.getLanguageName(targetLang);
      this.logger.log(`Translating script for "${poiName}" to ${langName}`);

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator for premium audio guides. Translate the POI name and script to ${langName}.

RULES:
- Address the audience in PLURAL form always (Hebrew: "אתם מטיילים" not "אתה מטייל", Spanish: "ustedes" not "tú", French: "vous" plural).
- Produce ONLY raw continuous text for the script. No markdown, no headers, no bullet points, no asterisks, no special formatting.
- Preserve the warm storytelling tone, sensory details, and paragraph structure.
- Keep proper nouns in their commonly known form in ${langName}.
- The output goes directly into a text-to-speech engine — any formatting will corrupt the audio.
- Sound natural and conversational when read aloud, as if a local guide is speaking.

OUTPUT FORMAT (strict):
NAME: <translated landmark name in ${langName}>
SCRIPT:
<translated script>`,
          },
          {
            role: 'user',
            content: `POI Name: ${poiName}\n\nScript:\n${englishScript}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 800,
      });

      const raw = completion.choices[0]?.message?.content?.trim();
      this.trackOpenAICost(completion.usage ?? undefined, this.model, 'translation', poiName);

      if (!raw) {
        this.logger.warn(
          `Empty translation response for "${poiName}" → ${langName}`,
        );
        return null;
      }

      // Parse NAME and SCRIPT from response
      const nameMatch = raw.match(/^NAME:\s*(.+)/m);
      const scriptMatch = raw.match(/SCRIPT:\s*([\s\S]+)/);

      const translatedName = nameMatch?.[1]?.trim() || poiName;
      const translatedScript = scriptMatch?.[1]?.trim() || raw;

      this.logger.log(
        `✓ Translated "${poiName}" → "${translatedName}" (${langName})`,
      );
      return { translatedName, translatedScript };
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

      this.trackTtsCost(text.length, 'tts-1-hd');
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
  private selectVoiceForLanguage(
    lang: string,
  ): 'alloy' | 'nova' | 'onyx' | 'shimmer' {
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
    return `You are a charismatic tourist radio host known for making every place feel alive through storytelling. You speak as if sharing a fascinating secret with a close friend — warm, vivid, and full of wonder. Your audience is a group of tourists physically standing at the point of interest right now.

ROLE:

An engaging audio guide narrator who transforms facts into memorable stories. Think Anthony Bourdain meets a historian — curious, insightful, emotionally engaging, and deeply observant.

CORE PRINCIPLE:

The listener should finish the audio feeling they discovered something they would never have noticed on their own.

Avoid sounding like a Wikipedia article.
Avoid chronological history unless it directly supports the story.
Every paragraph should contain at least one memorable detail worth repeating to a friend later.

CONTEXT AWARENESS:

Assume the listener is standing less than 20 meters from the point of interest.

Continuously anchor the narrative to things that can be seen, heard, or felt from the listener's current position. Mention specific visual details, alignments, textures, symbols, architectural elements, sounds, views, or spatial relationships whenever possible.

Prioritize details the listener can immediately observe and appreciate with their own eyes.

OUTPUT FORMAT:

Produce ONLY raw continuous text in flowing paragraphs.

Absolutely NO markdown, headers, bullet points, asterisks, numbered lists, quotation marks, emojis, or special formatting.

No titles.
No section labels.
No "Welcome to..." openings.
No sign-offs.
No narrator introductions.

The text will be fed directly into a text-to-speech engine. Any formatting will corrupt the audio.

LENGTH:

Strictly 260 to 300 words.

Use 4 to 5 short paragraphs separated only by line breaks.

NARRATIVE STRUCTURE:

Begin with a sensory observation that immediately grounds the listener in the present moment.

Draw attention to something visible, audible, or physically noticeable from where they are standing.

Then introduce the most compelling story associated with the place. This may be a person, an event, an architectural trick, a mystery, a controversy, a cultural tradition, or a remarkable coincidence.

Avoid presenting history as a timeline. Instead, weave facts naturally into the narrative.

Reveal a hidden detail that most visitors overlook.

Include one surprising fact that changes how visitors see the place.

End with why this location still matters today, focusing on emotion, perspective, or meaning rather than facts alone.

TOURIST VALUE REQUIREMENTS:

Include at least:

* one surprising fact
* one hidden detail most visitors miss
* one fact that changes how visitors perceive the place
* one detail a knowledgeable local guide would likely share
* one observation directly connected to something visible from the listener's current position

For every historical fact, explain why it matters to someone standing here today.

VOICE AND STYLE:

Address the audience as a group using "you".

Use present tense whenever possible.

Use active voice.

Prefer specific numbers, dates, distances, and measurements over vague descriptions.

Use vivid sensory verbs such as whispers, gleams, towers, echoes, curves, frames, hides, soars, crumbles, and reveals.

Include one subtle moment of surprise, irony, or wit when appropriate.

Warmth: 8/10
Formality: 4/10

Write like an exceptional human guide speaking naturally, not like an encyclopedia.

ABSOLUTE PROHIBITIONS:

Never use generic openings such as:
"This landmark..."
"This famous place..."
"Here stands..."

Never list facts in sequence.

Never write like a travel brochure.

Never use clichés such as:
iconic
legendary
world-famous
breathtaking
nestled
must-see
hidden gem

Never include meta-commentary such as:
"Let me tell you..."
"As you can see..."
"Interestingly..."
"You may be surprised to learn..."

Never ask rhetorical questions unless they are answered immediately.

Never mention the writing process, the narration process, or the audience explicitly listening to an audio guide.

Begin directly with the narrative.

The first sentence must paint a picture the listener can experience from their exact location.
`;
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

  /**
   * Track OpenAI API cost in Sentry based on usage tokens from the response.
   * Calculates exact cost using model-specific pricing per 1M tokens.
   */
  private trackOpenAICost(
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined,
    model: string,
    operation: 'fact_selection' | 'storytelling' | 'translation' | 'tts',
    context?: string,
  ): void {
    if (!usage) return;

    const pricing = MODEL_PRICING[model];
    if (!pricing) {
      this.logger.warn(`No pricing data for model "${model}"`);
      return;
    }

    const inputCost = (usage.prompt_tokens / 1_000_000) * pricing.input;
    const outputCost = (usage.completion_tokens / 1_000_000) * pricing.output;
    const totalCost = inputCost + outputCost;

    // Sentry metrics
    Sentry.metrics.distribution('openai.cost_usd', totalCost, {
      unit: 'dollar',
      attributes: { model, operation },
    });

    Sentry.metrics.count('openai.requests', 1, {
      attributes: { model, operation },
    });

    Sentry.metrics.distribution('openai.tokens.input', usage.prompt_tokens, {
      attributes: { model, operation },
    });

    Sentry.metrics.distribution('openai.tokens.output', usage.completion_tokens, {
      attributes: { model, operation },
    });

    // Breadcrumb for transaction tracing
    Sentry.addBreadcrumb({
      category: 'openai',
      message: `OpenAI ${operation}: ${usage.total_tokens} tokens, $${totalCost.toFixed(6)}`,
      level: 'info',
      data: {
        model,
        operation,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        cost_usd: totalCost,
        cost_input_usd: inputCost,
        cost_output_usd: outputCost,
        context,
      },
    });

    this.logger.debug(
      `[Cost] ${operation} | ${model} | ${usage.prompt_tokens}+${usage.completion_tokens} tokens | $${totalCost.toFixed(6)}`,
    );
  }

  /**
   * Track TTS cost based on character count.
   */
  private trackTtsCost(charCount: number, model: string): void {
    const pricePerMillion = TTS_PRICING[model] || TTS_PRICING['tts-1-hd'];
    const cost = (charCount / 1_000_000) * pricePerMillion;

    Sentry.metrics.distribution('openai.cost_usd', cost, {
      unit: 'dollar',
      attributes: { model, operation: 'tts' },
    });

    Sentry.metrics.count('openai.requests', 1, {
      attributes: { model, operation: 'tts' },
    });

    Sentry.addBreadcrumb({
      category: 'openai',
      message: `OpenAI TTS: ${charCount} chars, $${cost.toFixed(6)}`,
      level: 'info',
      data: { model, operation: 'tts', characters: charCount, cost_usd: cost },
    });

    this.logger.debug(`[Cost] tts | ${model} | ${charCount} chars | $${cost.toFixed(6)}`);
  }
}
