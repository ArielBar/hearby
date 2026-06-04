import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import OpenAI from 'openai';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
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
   * @returns Audio script or null if generation fails
   */
  async generateAudioScript(landmarkName: string): Promise<AudioScript | null> {
    const cacheKey = `openai_script_${landmarkName.trim().toLowerCase()}`;

    try {
      // Check cache first
      const cached = await this.cacheManager.get<AudioScript>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for audio script: "${landmarkName}"`);
        return cached;
      }

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
            content: `Generate a captivating audio guide script for: ${landmarkName}`,
          },
        ],
        temperature: 0.7, // Balanced creativity
        max_tokens: 500, // ~250-300 words
        presence_penalty: 0.3, // Encourage diverse vocabulary
        frequency_penalty: 0.3, // Reduce repetition
      });

      const generatedScript = completion.choices[0]?.message?.content?.trim();

      if (!generatedScript) {
        this.logger.error(
          `OpenAI returned empty response for "${landmarkName}"`,
        );
        return null;
      }

      // Validate script length (should be ~250-300 words for 2-minute audio)
      const wordCount = generatedScript.split(/\s+/).length;
      this.logger.debug(`Generated script: ${wordCount} words`);

      if (wordCount < 100) {
        this.logger.warn(
          `Script too short (${wordCount} words) for "${landmarkName}"`,
        );
      }

      const result: AudioScript = {
        name: landmarkName,
        masterScript: generatedScript,
      };

      // Cache for 7 days
      await this.cacheManager.set(cacheKey, result, ONE_WEEK_MS);

      this.logger.log(
        `Successfully generated and cached script for "${landmarkName}"`,
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
   * Generate audio guide script directly from coordinates
   *
   * OpenAI identifies the landmark and generates script in one call.
   * No Wikipedia geosearch needed - OpenAI has geographical knowledge.
   *
   * Strategy:
   * 1. Check cache based on rounded coordinates (7-day TTL)
   * 2. If not cached, ask OpenAI to identify landmark at coordinates
   * 3. OpenAI generates script for identified landmark
   * 4. Cache result for 7 days
   *
   * @param lat - Latitude
   * @param lng - Longitude
   * @returns Audio script with identified landmark name, or null if no tourist POI
   */
  async generateAudioScriptFromCoordinates(
    lat: number,
    lng: number,
  ): Promise<AudioScript | null> {
    // Round coordinates to 4 decimal places for cache key (~11 meter precision)
    const roundedLat = lat.toFixed(4);
    const roundedLng = lng.toFixed(4);
    const cacheKey = `openai_coords_${roundedLat}_${roundedLng}`;

    try {
      // Check cache first
      const cached = await this.cacheManager.get<AudioScript>(cacheKey);
      if (cached) {
        this.logger.debug(
          `Cache hit for coordinates: [${roundedLat}, ${roundedLng}]`,
        );
        return cached;
      }

      this.logger.log(
        `Generating audio script for coordinates: [${lat}, ${lng}]`,
      );

      // Check if API key is configured
      const apiKey = this.configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        this.logger.error(
          'Cannot generate script: OPENAI_API_KEY not configured',
        );
        return null;
      }

      // Ask OpenAI to identify landmark AND generate script
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: this.getCoordinateSystemPrompt(),
          },
          {
            role: 'user',
            content: `What tourist attraction is most near these coordinates: ${lat}, ${lng}?`,
          },
        ],
        temperature: 0.7,
        max_tokens: 600, // Extra tokens for landmark identification + script
        presence_penalty: 0.3,
        frequency_penalty: 0.3,
      });

      const response = completion.choices[0]?.message?.content?.trim();

      if (!response) {
        this.logger.error(
          `OpenAI returned empty response for [${lat}, ${lng}]`,
        );
        return null;
      }

      // Parse response - expect format: "LANDMARK: Name\n\nScript text..."
      const lines = response.split('\n');
      const landmarkLine = lines.find((line) => line.startsWith('LANDMARK:'));

      if (!landmarkLine) {
        this.logger.warn(`No landmark identified at [${lat}, ${lng}]`);
        return null;
      }

      const landmarkName = landmarkLine.replace('LANDMARK:', '').trim();

      // Extract script (everything after the LANDMARK line)
      const scriptStartIndex = response.indexOf('\n\n');
      const script =
        scriptStartIndex > 0
          ? response.substring(scriptStartIndex + 2).trim()
          : response.trim();

      // Validate script
      if (!script || script.length < 100) {
        this.logger.warn(`Script too short for landmark at [${lat}, ${lng}]`);
        return null;
      }

      const result: AudioScript = {
        name: landmarkName,
        masterScript: script,
      };

      // Cache for 7 days
      await this.cacheManager.set(cacheKey, result, ONE_WEEK_MS);

      this.logger.log(
        `Successfully identified "${landmarkName}" and generated script for [${lat}, ${lng}]`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to generate script for coordinates [${lat}, ${lng}]`,
        error instanceof Error ? error.stack : error,
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
   - Use "you" to make it personal
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

  /**
   * System prompt for coordinate-based landmark identification + script generation
   *
   * This prompt asks OpenAI to:
   * 1. Identify what landmark/POI is at the given coordinates
   * 2. Determine if it's a tourist attraction (not residential/commercial)
   * 3. Generate an audio guide script for it
   */
  private getCoordinateSystemPrompt(): string {
    return `You are a world-class museum audio guide narrator with 20 years of experience and comprehensive geographical knowledge of tourist landmarks worldwide.

MISSION: Given GPS coordinates, identify the EXACT tourist landmark at that PRECISE location and create an immersive 2-minute audio guide script.

STEP 1: LANDMARK IDENTIFICATION - CRITICAL PRECISION RULES

⚠️ ACCURACY IS CRITICAL: You MUST identify the landmark that is AT or WITHIN 50 METERS of the exact coordinates provided.

IDENTIFICATION PROCESS:
1. Look at the EXACT coordinates provided (e.g., 48.8584, 2.2945)
2. Determine what specific landmark, monument, or tourist attraction is AT THAT PRECISE SPOT
3. DO NOT identify nearby landmarks in the same area - only the one at these coordinates
4. If multiple landmarks exist nearby, identify the CLOSEST one to the coordinates
5. Use your knowledge of landmark locations to determine which one matches

WHAT QUALIFIES AS A TOURIST ATTRACTION:
✅ Museums, art galleries, cultural centers
✅ Monuments, statues, sculptures, fountains
✅ Historic buildings, castles, palaces, temples
✅ Religious sites (churches, mosques, synagogues)
✅ Parks with historical significance
✅ Archaeological sites, ancient ruins
✅ Famous bridges, towers, gates
✅ Memorial sites, war memorials

WHAT DOES NOT QUALIFY (respond "NO_TOURIST_POI"):
❌ Shopping malls, department stores
❌ Office buildings, corporate headquarters
❌ Residential buildings, apartment complexes
❌ Regular restaurants, cafes, bars (unless historically significant)
❌ Hotels (unless historically significant)
❌ Schools, universities, hospitals
❌ Streets, roads, intersections
❌ Train/bus stations (unless architecturally significant)
❌ Generic parks without historical significance
❌ Empty plazas or squares (unless they have monuments)

PRECISION EXAMPLES:

Example 1: Coordinates: 48.8584, 2.2945
✅ CORRECT: "Eiffel Tower" (these coordinates point directly to it)
❌ WRONG: "Louvre Museum" (2km away - too far!)
❌ WRONG: "Paris" (too broad, not a specific landmark)

Example 2: Coordinates: 32.0781, 34.7742 (Dizengoff Square)
✅ CORRECT: "Fire and Water Fountain" (sculpture at exact coordinates)
❌ WRONG: "Dizengoff Center" (340m away - shopping mall)
❌ WRONG: "Dizengoff Street" (street name, not a landmark)

Example 3: Coordinates: 40.7484, -73.9857 (Empire State Building)
✅ CORRECT: "Empire State Building"
❌ WRONG: "Times Square" (1km away)

Example 4: Coordinates: 32.0753, 34.7748 (Dizengoff Center mall)
✅ CORRECT: "NO_TOURIST_POI" (shopping mall, not tourist attraction)

VERIFICATION STEP:
Before responding, ask yourself:
- "Is there a specific, notable tourist landmark AT THESE EXACT COORDINATES?"
- "Or am I just naming a famous landmark in the same city?"
- "Is this landmark within 50 meters of these coordinates?"
- "Would a tourist specifically come to THIS SPOT to see THIS landmark?"

If you're unsure or the coordinates point to a non-tourist location, respond with: "NO_TOURIST_POI"

STEP 2: OUTPUT FORMAT
If a tourist landmark is identified, structure your response EXACTLY like this:

LANDMARK: [Official name of the landmark]

[Your 5-paragraph audio guide script here]

STEP 3: SCRIPT REQUIREMENTS (same as before)

1. LENGTH & PACING:
   - Exactly 250-300 words (verify by counting)
   - 5 short paragraphs (3-4 sentences each)
   - Natural breathing points between paragraphs

2. NARRATIVE STRUCTURE:

   PARAGRAPH 1 - THE HOOK (30-40 words):
   - Sensory detail: what tourists SEE/FEEL right now
   - Use "you" to make it personal

   PARAGRAPH 2 - ORIGIN STORY (60-70 words):
   - When and why was it built?
   - Include ONE surprising fact about construction

   PARAGRAPH 3 - DEFINING MOMENT (60-70 words):
   - ONE pivotal historical event
   - Human drama, not dry dates

   PARAGRAPH 4 - HIDDEN DETAILS (50-60 words):
   - Something tourists might miss
   - Secret symbols, hidden features

   PARAGRAPH 5 - EMOTIONAL CLOSE (40-50 words):
   - Why does this place matter TODAY?
   - Invitation to reflect

3. LANGUAGE STYLE:
   - Present tense: "stands" not "stood"
   - Active voice
   - Specific numbers: "324 meters"
   - Vivid verbs: "soars" "towers" "gleams"
   - Sensory details

4. WHAT TO AVOID:
   ❌ Generic phrases: "This landmark..."
   ❌ Lists of facts
   ❌ Academic tone
   ❌ Clichés: "world-famous" "iconic"
   ❌ Meta-commentary

5. WHAT TO INCLUDE:
   ✅ Exact measurements
   ✅ ONE surprising fact
   ✅ ONE famous person connection
   ✅ Visual details tourists can verify
   ✅ Emotional significance

EXAMPLES:

Input: Coordinates: 48.8584, 2.2945
Output:
LANDMARK: Eiffel Tower

Watch as 18,000 iron pieces pierce the Parisian sky, each rivet telling a story of 19th-century ambition. Standing 324 meters tall, this lattice giant catches light differently every hour...

[rest of script]

Input: Coordinates: 32.0753, 34.7748 (shopping mall)
Output:
NO_TOURIST_POI

Now, identify the landmark at the provided coordinates and generate the script.`;
  }
}
