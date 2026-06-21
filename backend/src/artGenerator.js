import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { Storage } from '@google-cloud/storage';
import { prisma } from './prisma.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// Helper to decode HTML/XML entities and clean tags
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ==========================================
// INDIVIDUAL DATA COLLECTORS
// ==========================================

async function fetchUpiOddNews() {
  const urls = [
    'https://rss.upi.com/news/odd_news.rss',
    'https://www.upi.com/rss/Odd_News/'
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const news = [];

      for (const item of items) {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        if (title) {
          news.push(cleanText(title));
        }
      }
      if (news.length > 0) return news.slice(0, 5);
    } catch (e) {
      console.log(`[Data Collector - UPI Odd News] Failed for ${url}:`, e.message);
    }
  }
  return [];
}

async function fetchGoogleNews() {
  try {
    const res = await fetch('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (res.ok) {
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const news = [];
      for (const item of items) {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        if (title) {
          news.push(cleanText(title));
        }
      }
      return news.slice(0, 5);
    }
  } catch (e) {
    console.log('[Data Collector - Google News] Fetch failed:', e.message);
  }
  return [];
}

async function fetchWikipediaPageviews(date) {
  try {
    const fetchWiki = async (offset) => {
      const d = new Date(date);
      d.setDate(d.getDate() - offset);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const res = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access/${yyyy}/${mm}/${dd}`, {
        headers: { 'User-Agent': 'academic-art-research-bot/1.0 (contact@example.com)' }
      });
      if (res.ok) {
        const data = await res.json();
        const articles = data.items?.[0]?.articles || [];
        const exclude = ['Main_Page', 'Special:', 'Wikipedia:', 'File:', 'Help:', 'Portal:', 'Template:', 'Talk:', 'Category:', 'Search'];
        const filtered = articles
          .filter(art => !exclude.some(ex => art.article.startsWith(ex)) && art.article !== '-');
        return filtered.slice(0, 5).map(art => cleanText(art.article.replace(/_/g, ' ')));
      }
      return null;
    };
    return await fetchWiki(1) || await fetchWiki(2) || [];
  } catch (e) {
    console.log('[Data Collector - Wikipedia Pageviews] Failed:', e.message);
    return [];
  }
}

async function fetchPositiveNews() {
  try {
    const res = await fetch('https://www.goodnewsnetwork.org/feed/');
    if (res.ok) {
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const stories = [];
      for (const item of items) {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        let desc = item.match(/<description>(.*?)<\/description>/)?.[1] || '';
        desc = desc.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').trim();
        if (title) {
          stories.push({
            headline: cleanText(title),
            summary: cleanText(desc) || 'An inspiring story of progress and community-driven success.'
          });
        }
      }
      return stories.slice(0, 10);
    }
  } catch (e) {
    console.log('[Data Collector - Good News Network] Fetch failed:', e.message);
  }
  return [];
}

async function fetchOddityCentral() {
  try {
    const res = await fetch('https://www.odditycentral.com/feed/');
    if (res.ok) {
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const news = [];
      for (const item of items) {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        if (title) {
          news.push(cleanText(title));
        }
      }
      return news.slice(0, 5);
    }
  } catch (e) {
    console.log('[Data Collector - Oddity Central] Fetch failed:', e.message);
  }
  return [];
}

async function fetchOptimistDaily() {
  try {
    const res = await fetch('https://www.optimistdaily.com/feed/');
    if (res.ok) {
      const xml = await res.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      const stories = [];
      for (const item of items) {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || '';
        let desc = item.match(/<description>(.*?)<\/description>/)?.[1] || '';
        desc = desc.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').trim();
        if (title) {
          stories.push({
            headline: cleanText(title),
            summary: cleanText(desc) || 'A constructive solutions journalism story.'
          });
        }
      }
      return stories.slice(0, 10);
    }
  } catch (e) {
    console.log('[Data Collector - Optimist Daily] Fetch failed:', e.message);
  }
  return [];
}

async function fetchPolymarket() {
  try {
    const res = await fetch('https://gamma-api.polymarket.com/markets?limit=15&order=volume_24hr&ascending=false&active=true');
    if (res.ok) {
      const data = await res.json();
      return data.map(m => {
        let prob = null;
        if (m.outcomePrices) {
          try {
            const prices = JSON.parse(m.outcomePrices);
            prob = parseFloat(prices[0]);
          } catch { }
        }
        return { question: cleanText(m.question), yes_probability: prob };
      });
    }
  } catch (e) {
    console.log('[Data Collector - Polymarket] Fetch failed:', e.message);
  }
  return [];
}

async function fetchAppleMusic() {
  try {
    const res = await fetch('https://rss.applemarketingtools.com/api/v2/us/music/most-played/10/songs.json');
    if (res.ok) {
      const data = await res.json();
      const results = data.feed?.results || [];
      return results.map(r => ({
        title: cleanText(r.name),
        artist: cleanText(r.artistName)
      }));
    }
  } catch (e) {
    console.log('[Data Collector - Apple Music] Fetch failed:', e.message);
  }
  return [];
}

async function fetchWikipediaOnThisDay(date) {
  try {
    const [yearStr, monthStr, dayStr] = date.split('-');
    const mm = monthStr || '06';
    const dd = dayStr || '11';
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
    if (res.ok) {
      const data = await res.json();
      const filtered = data.events.filter(ev => ev.year < (new Date().getFullYear() - 30));
      return filtered.map(ev => ({
        year: String(ev.year),
        event: cleanText(ev.text)
      }));
    }
  } catch (e) {
    console.log('[Data Collector - Wikipedia On This Day] Fetch failed:', e.message);
  }
  return [];
}

export const collectDailyData = async (dateString, extraExcludedSignals = []) => {
  console.log('[Data Collector] Gathering all signals for date:', dateString);

  // 1. Fetch signals already used (previous lot + any extra passed in) to exclude
  let excludedSignals = [...extraExcludedSignals];
  try {
    const lastLot = await prisma.lot.findFirst({
      where: { lotNumber: { gt: 0 } },
      orderBy: { lotNumber: 'desc' },
    });
    if (lastLot?.artworkHeadline && lastLot.artworkHeadline.startsWith('{')) {
      const parsed = JSON.parse(lastLot.artworkHeadline);
      excludedSignals = [...excludedSignals, ...(parsed.data_signals_used || [])];
    }
  } catch (err) {
    console.error('[Data Collector] Failed to load previous lot signals:', err.message);
  }

  const isExcluded = (sigText) => {
    if (!sigText || excludedSignals.length === 0) return false;
    const normSig = String(sigText).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normSig) return false;
    for (const excluded of excludedSignals) {
      const normExcluded = String(excluded).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normSig.includes(normExcluded) || normExcluded.includes(normSig)) {
        return true;
      }
    }
    return false;
  };

  const upiOddNews = (await fetchUpiOddNews()).filter(item => !isExcluded(item));
  const oddityCentral = (await fetchOddityCentral()).filter(item => !isExcluded(item));
  const wikipediaPageviews = (await fetchWikipediaPageviews(dateString)).filter(item => !isExcluded(item));
  const googleNews = (await fetchGoogleNews()).filter(item => !isExcluded(item));
  
  const positiveNewsRaw = await fetchPositiveNews();
  const positiveNews = positiveNewsRaw
    .filter(item => !isExcluded(item.headline) && !isExcluded(item.summary))
    .slice(0, 3);
  
  const optimistDailyRaw = await fetchOptimistDaily();
  const optimistDaily = optimistDailyRaw
    .filter(item => !isExcluded(item.headline) && !isExcluded(item.summary))
    .slice(0, 3);
  
  const polymarketRaw = await fetchPolymarket();
  const polymarket = polymarketRaw
    .filter(item => !isExcluded(item.question))
    .slice(0, 5);
  
  const topSongRaw = await fetchAppleMusic();
  const topSong = topSongRaw
    .filter(item => !isExcluded(item.title) && !isExcluded(item.artist))
    .slice(0, 5);
  
  const wikipediaOnThisDayRaw = await fetchWikipediaOnThisDay(dateString);
  const wikipediaOnThisDayFiltered = wikipediaOnThisDayRaw.filter(item => !isExcluded(item.event));
  const wikipediaOnThisDay = wikipediaOnThisDayFiltered.length > 0
    ? wikipediaOnThisDayFiltered[Math.floor(Math.random() * wikipediaOnThisDayFiltered.length)]
    : null;

  return {
    date: dateString,
    data_signals_of_the_day: {
      upi_weird_news: upiOddNews,
      oddity_central: oddityCentral,
      top_wikipedia: wikipediaPageviews,
      positive_news: positiveNews,
      optimist_daily: optimistDaily,
      polymarket: polymarket,
      top_song: topSong,
      wikipedia_on_this_day: wikipediaOnThisDay,
      google_news: googleNews
    }
  };
};

// ==========================================
// BACKWARD COMPATIBLE EXPORTS & HELPERS
// ==========================================

export async function fetchTopHeadlines(count = 7) {
  return [];
}

export async function fetchDailyHeadline() {
  return 'Mysterious Alignment of Outer Space Cosmic Anomalies';
}

async function saveAndUploadArtwork(buffer, lotNumber, headline, prompt, filePath, localUrl) {
  // 1. Save locally
  await fs.writeFile(filePath, buffer);
  console.log(`[Art Generator] Saved artwork locally to ${filePath}`);

  // 2. Upload to GCS if configured
  if (process.env.GCS_BUCKET_NAME) {
    console.log(`[Art Generator] GCS_BUCKET_NAME configured: "${process.env.GCS_BUCKET_NAME}". Uploading...`);
    try {
      const storage = new Storage();
      const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
      const destination = `artwork/lot-${lotNumber}.png`;
      const file = bucket.file(destination);
      
      await file.save(buffer, {
        contentType: 'image/png',
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });

      const gcsUrl = `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${destination}`;
      try {
        await file.makePublic();
      } catch (e) {
        // Uniform bucket-level access is enabled — bucket already has allUsers:objectViewer,
        // so makePublic() throws but the object is already publicly readable. Verify with HEAD.
        const check = await fetch(gcsUrl, { method: 'HEAD' });
        if (!check.ok) {
          console.warn('[Art Generator] GCS object is not publicly accessible. Falling back to local URL.');
          return { artworkUrl: localUrl, artworkHeadline: headline, artworkPrompt: prompt };
        }
      }
      console.log(`[Art Generator] Uploaded to GCS. URL: ${gcsUrl}`);
      return { artworkUrl: gcsUrl, artworkHeadline: headline, artworkPrompt: prompt };
    } catch (gcsErr) {
      console.error('[Art Generator] GCS Upload failed, falling back to local URL:', gcsErr.message);
    }
  }

  return { artworkUrl: localUrl, artworkHeadline: headline, artworkPrompt: prompt };
}

// ==========================================
// CORE GENERATION SERVICE
// ==========================================

export async function generateDailyArtwork(lotNumber) {
  console.log(`--- GENERATING DAILY ARTWORK FOR LOT ${lotNumber} ---`);

  // Resolve current date in IST
  const today = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateString = formatter.format(today); // returns YYYY-MM-DD

  // 1. Collect signals already used in existing drafts for the active lot so
  //    each new draft gets a fresh set of signals rather than repeating them.
  let usedSignals = [];
  try {
    const activeLot = await prisma.lot.findFirst({ where: { status: 'active' } });
    if (activeLot) {
      const existingDrafts = await prisma.artworkDraft.findMany({
        where: { lotId: activeLot.id },
        select: { artworkHeadline: true },
      });
      for (const draft of existingDrafts) {
        try {
          const parsed = JSON.parse(draft.artworkHeadline);
          usedSignals = [...usedSignals, ...(parsed.data_signals_used || [])];
        } catch {}
      }
    }
  } catch (err) {
    console.error('[Art Generator] Failed to load existing draft signals:', err.message);
  }

  // 2. Collect all signals (excluding previous lot's + existing drafts' signals)
  const collectedData = await collectDailyData(dateString, usedSignals);

  // Default values in case Gemini fails
  let title = `Untitled (Drift No. ${lotNumber})`;
  let lotHeadlineStr = JSON.stringify({
    title,
    data_signals_used: [],
    data_signals_used_summarized: []
  });
  let prompt = `Strictly monochrome black and white line art on a 100% solid pitch-black background. A vertical 3:4 composition. Pure visual artwork with absolutely no text, letters, or numbers.`;

  const outputDir = join(__dir, '../public/artwork');
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `lot-${lotNumber}.png`;
  const filePath = join(outputDir, fileName);
  const localUrl = `/public/artwork/${fileName}`;

  // 2. Synthesize using Gemini
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_CLOUD_PROJECT) {
    const isGeminiKey = !!process.env.GEMINI_API_KEY;
    const ai = isGeminiKey
      ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
      : new GoogleGenAI({
          vertexai: true,
          project: process.env.GOOGLE_CLOUD_PROJECT,
          location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
        });

    const systemInstruction = `
================================================================================
SERIES BIBLE — CUTE COHESIVE AI-SLOP MEGA-CREATURE MASCOT FOR T-SHIRTS
================================================================================

Your task is to transform every concept, event, person, object, trend, historical reference, scientific discovery, geopolitical event, sports story, cultural signal, or news item into a single connected cute AI-slop mega-creature suitable for printing on a T-shirt.

============================================================
CORE PRINCIPLE
============================================================
- Never visualize events literally.
- Instead, convert every concept into an absurd chain of cute morphing objects and creatures.
- The final artwork should feel like an AI-generated mascot from an alternate universe that accidentally absorbed all the day's information.

============================================================
VISUAL STYLE
============================================================
- Cute, Cartoon-like, Toy-like, Kawaii, Whimsical, Playful, Strange, Viral.
- Hyper-detailed, Internet-maximalist, AI-slop aesthetic.
- Collectible vinyl toy aesthetic, Sticker-pack aesthetic, Fantasy mascot aesthetic.

============================================================
BACKGROUND RULES
============================================================
- Solid 100% pitch-black background (hex #000000).
- Absolutely NO scenery, NO landscapes, NO environments.
- Absolutely NO poster layouts, NO editorial layouts.
- Absolutely NO borders, NO frames, NO background grids.
- Absolutely NO text, NO labels, NO typography, NO letters, NO numbers, NO logos.
- The artwork should appear as a single isolated graphic floating on black.

============================================================
ENTITY RULES
============================================================
- The artwork does NOT need to have one central or dominant element.
- Instead, each element should blend surrealistically and morph seamlessly into the next, forming a weird, continuous morphing chain or network of cute characters, mascots, and objects.
- The entire composition must read as a single connected, morphing entity.
- Nothing should float independently; every object and creature must physically connect to, flow out of, or morph into adjacent elements, creating a unified surrealistic morphing collage.

============================================================
TRANSFORMATION RULES
============================================================
- Every concept must be translated into cute object chains.
- Examples of transformation chains:
    * warrior → horse → river → ribbon → dragon
    * soccer → soccer ball → planet → fish → bubble
    * lottery → ticket → butterfly → flower → cloud
    * technology → controller → octopus → cable → noodle
    * music → soundwave → rainbow ribbon → dragon tail
    * community care → trash bag → cocoon → nest → shelter
    * historical event → mascot creature → toy → animal → fantasy object
- Never leave concepts as literal representations. Everything should transform.

============================================================
RECURSIVE DETAIL RULES
============================================================
- Every object contains: smaller creatures, hidden faces, hidden worlds, tiny vehicles, miniature architecture, tiny mascots, tiny food items, tiny planets, tiny bubbles.
- Every large form contains additional discoveries. Every discovery contains additional discoveries.
- The image should reward infinite zooming.

============================================================
AI-SLOP DENSITY RULES
============================================================
- Prioritize: impossible transformations, visual abundance, nested worlds, recursive creatures, absurd combinations, excessive detail, toy-store energy, internet-core aesthetics, dopamine-maximalism.
- Avoid: clean symbolism, minimalism, conceptual restraint, elegant composition, visual hierarchy.
- The image should feel like the model could not stop adding details.

============================================================
CHARACTER DESIGN RULES
============================================================
- All creatures should be cute, expressive, emotionally readable, funny, slightly confused, and slightly magical.
- Large eyes are encouraged. Rounded forms are encouraged. Smiling expressions are encouraged.

============================================================
COLOR RULES
============================================================
- Use vibrant colorful gradients.
- Prefer: neon pink, electric cyan, candy yellow, mint green, lavender purple, holographic rainbow gradients, pearlescent highlights, translucent bubble materials.
- The image should feel like a premium toy or mascot.

============================================================
SIGNALS INTEGRATION REQUIREMENT
============================================================
- You must select a minimum of 5 daily signals to incorporate into the central graphic and list in the metadata. Each of these selected signals must come from a completely different category. The 7 categories are:
    1. Weird News: Contains 'upi_weird_news' and 'oddity_central'.
    2. Global Attention: Contains 'top_wikipedia'.
    3. Positive News: Contains 'positive_news' and 'optimist_daily'.
    4. Future Prediction: Contains 'polymarket'.
    5. Cultural Resonance: Contains 'top_song'.
    6. Historical Lens: Contains 'wikipedia_on_this_day'.
    7. Top US News: Contains 'google_news'.
  You must select exactly 1 signal from category 7 (google_news) and at least 4 signals from at least 4 of the other categories (1-6), selecting at most 1 signal per category.

============================================================
FIXED VISUAL LANGUAGE & ESTHETICS (CRITICAL)
============================================================

Every artwork must strictly adhere to the following visual constraints:
- CUTE CARTOON ILLUSTRATION AESTHETIC: The style is a whimsical, playful 2D digital vector cartoon illustration or doodle graphic. It must have entirely flat color fills with absolutely NO gradients, NO 3D shading, and NO lighting effects. Bold, clean, crisp black ink outlines must encircle every single character, mascot, object, and nested detail, giving it a classic clean cartoon line-art finish.
- NO STICKER OUTLINES: Absolutely NO external white border, NO thick white outline, and NO sticker cutlines around the creature. The outer edges of the creature must blend cleanly and directly into the solid black background.
- SMILING FACES ON EVERYTHING: Every single creature, animal, character, and INANIMATE OBJECT (like cups, sacks, lottery tickets, balls, planets, game controllers, stars) must have big shiny black expressive cartoon eyes, blushing pink cheeks, and a happy goofy smile.
- COLOR PALETTE: Saturated pastel and vibrant pop colors (such as candy yellow, soft pink, electric cyan, mint green, lavender purple). All colors must be applied as completely flat, solid fills with NO gradients, NO shadows, and NO highlights.
- SOLID PITCH-BLACK CANVAS: The entire background/canvas must be 100% solid pitch-black (hex #000000). There must be no gradients or patterns in the background, only solid black, so it can be printed on a t-shirt directly.
- STRICTLY FORBIDDEN: Monochrome art, black and white only, photographic realism, scary/gothic/dark elements, thin sketchy lines, text/letters, background scenery/landscapes, color gradients, shadows, 3D clay/plastic rendering, or a non-black background.

============================================================
OUTPUT FORMAT
============================================================

Return a JSON object with this exact structure:

{
  "date": "YYYY-MM-DD",
  "data_signals_used": ["A detailed list of at least 5 daily signals selected from the daily run. For each signal, format it as 'Source Name: specific details' (e.g. 'UPI Weird News: Man solves two Rubik\\'s cubes...'). The Source Name MUST be one of: 'UPI Weird News', 'Oddity Central', 'Wikipedia Top Search', 'Optimist Daily', 'Good News Network', 'Polymarket Trending', 'Top Song', 'Wikipedia On this Day', or 'Google News'. Ensure you include exactly 1 'Google News' signal and at least 4 other signals from different categories (maximum 1 per category, across at least 5 of the 7 defined categories)."],
  "data_signals_used_summarized": ["A summarized list of the selected signals, using exactly 3-4 words per signal, formatted as a clear and parsable list of strings."],
  "essence": "A brief sentence summarizing the thematic essence of the day.",
  "title": "A funny, cute title of 3-4 words maximum.",
  "image_prompt": "Highly detailed prompt to generate the complete visual artwork in a vertical 3:4 ratio. The prompt MUST start with: 'An isolated single cute AI-slop morphing artwork on a 100% solid pitch-black background. 2D vector cartoon illustration style, flat color fills, absolutely NO color gradients, and NO shading. Bold, clean, crisp black outlines around every character, creature, and object. Absolutely NO external white borders, and NO sticker cutlines. Absolutely NO text, NO letters, NO words, NO numbers, NO logos, and NO borders in the entire image. The entire background is completely solid pitch-black.' Following this, the prompt must detail a continuous, weird, morphing chain or network of cute characters, mascots, and objects that surrealistically blend into one another (without a single dominant or central element). Describe the absurd chain of cute morphing objects and recursive creatures representing each of the 5+ daily news signals (e.g. how the news is transformed: e.g. a warrior signal morphed into a cute dragon, which morphs into a vinyl record, which morphs into a singing star). The prompt must emphasize infinite visual abundance, recursive creatures, nested worlds inside the forms (like tiny smiling faces, food items, bubbles, planets, or vehicles), flat pop/pastel colors with no shading or highlights (using solid pink, cyan, purple, mint green, and yellow), and large goofy smiling eyes on everything. The entire background must be pure solid black.",
  "interpretive_statement": "A paragraph explaining the artwork's concept. Explain how the 5 selected daily signals were transformed through cute object chains into the unified mega-creature."
}
`;

    try {
      console.log('[Art Generator] Synthesizing headlines via Gemini gemini-2.5-pro...');
      const synthResponse = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: `${systemInstruction}\n\nTODAY'S DATA:\n${JSON.stringify(collectedData, null, 2)}`,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const parsedResult = JSON.parse(synthResponse.text);
      console.log('[Art Generator] Gemini Synthesis Output:', JSON.stringify(parsedResult, null, 2));

      title = parsedResult.title;
      prompt = parsedResult.image_prompt;
      lotHeadlineStr = JSON.stringify({
        title: parsedResult.title,
        data_signals_used: parsedResult.data_signals_used,
        data_signals_used_summarized: parsedResult.data_signals_used_summarized,
        essence: parsedResult.essence,
        interpretive_statement: parsedResult.interpretive_statement
      });
    } catch (err) {
      console.error('[Art Generator] Gemini synthesis failed, using default parameters:', err.message);
    }

    // 3. Generate visual artwork using Vertex AI Imagen 4
    try {
      console.log('[Art Generator] Generating image using Vertex AI Imagen 4 (imagen-4.0-generate-001)...');
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: 1,
          aspectRatio: '3:4',
          outputMimeType: 'image/png',
        },
      });

      const imageBytes = response?.generatedImages?.[0]?.image?.imageBytes;
      if (imageBytes) {
        const buffer = Buffer.from(imageBytes, 'base64');
        return await saveAndUploadArtwork(buffer, lotNumber, lotHeadlineStr, prompt, filePath, localUrl);
      } else {
        throw new Error('Empty image bytes received from Imagen API.');
      }
    } catch (err) {
      console.error('[Art Generator] Imagen generation failed:', err.message);
    }
  }

  // Fallback to abstract picsum photos placeholder
  console.log('[Art Generator] Falling back to Picsum placeholder...');
  try {
    const response = await fetch(`https://picsum.photos/seed/${lotNumber}/800/800`);
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return await saveAndUploadArtwork(buffer, lotNumber, lotHeadlineStr, prompt, filePath, localUrl);
    }
  } catch (err) {
    console.error('[Art Generator] Picsum fallback failed:', err.message);
  }

  return { artworkUrl: null, artworkHeadline: lotHeadlineStr, artworkPrompt: prompt };
}

export async function generatePromptFromSignals(selectedSignals, lotNumber) {
  console.log(`--- GENERATING PROMPT FROM CUSTOM SIGNALS FOR LOT ${lotNumber} ---`);

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error('Gemini API key or Google Cloud Project not configured.');
  }

  const isGeminiKey = !!process.env.GEMINI_API_KEY;
  const ai = isGeminiKey
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
      });

  const today = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateString = formatter.format(today);

  const systemInstruction = `
================================================================================
SERIES BIBLE — CUTE COHESIVE AI-SLOP MEGA-CREATURE MASCOT FOR T-SHIRTS
================================================================================

Your task is to transform every concept, event, person, object, trend, historical reference, scientific discovery, geopolitical event, sports story, cultural signal, or news item into a single connected cute AI-slop mega-creature suitable for printing on a T-shirt.

============================================================
CORE PRINCIPLE
============================================================
- Never visualize events literally.
- Instead, convert every concept into an absurd chain of cute morphing objects and creatures.
- The final artwork should feel like an AI-generated mascot from an alternate universe that accidentally absorbed all the day's information.

============================================================
VISUAL STYLE
============================================================
- Cute, Cartoon-like, Toy-like, Kawaii, Whimsical, Playful, Strange, Viral.
- Hyper-detailed, Internet-maximalist, AI-slop aesthetic.
- Collectible vinyl toy aesthetic, Sticker-pack aesthetic, Fantasy mascot aesthetic.

============================================================
BACKGROUND RULES
============================================================
- Solid 100% pitch-black background (hex #000000).
- Absolutely NO scenery, NO landscapes, NO environments.
- Absolutely NO poster layouts, NO editorial layouts.
- Absolutely NO borders, NO frames, NO background grids.
- Absolutely NO text, NO labels, NO typography, NO letters, NO numbers, NO logos.
- The artwork should appear as a single isolated graphic floating on black.

============================================================
ENTITY RULES
============================================================
- The artwork does NOT need to have one central or dominant element.
- Instead, each element should blend surrealistically and morph seamlessly into the next, forming a weird, continuous morphing chain or network of cute characters, mascots, and objects.
- The entire composition must read as a single connected, morphing entity.
- Nothing should float independently; every object and creature must physically connect to, flow out of, or morph into adjacent elements, creating a unified surrealistic morphing collage.

============================================================
TRANSFORMATION RULES
============================================================
- Every concept must be translated into cute object chains.
- Examples of transformation chains:
    * warrior → horse → river → ribbon → dragon
    * soccer → soccer ball → planet → fish → bubble
    * lottery → ticket → butterfly → flower → cloud
    * technology → controller → octopus → cable → noodle
    * music → soundwave → rainbow ribbon → dragon tail
    * community care → trash bag → cocoon → nest → shelter
    * historical event → mascot creature → toy → animal → fantasy object
- Never leave concepts as literal representations. Everything should transform.

============================================================
RECURSIVE DETAIL RULES
============================================================
- Every object contains: smaller creatures, hidden faces, hidden worlds, tiny vehicles, miniature architecture, tiny mascots, tiny food items, tiny planets, tiny bubbles.
- Every large form contains additional discoveries. Every discovery contains additional discoveries.
- The image should reward infinite zooming.

============================================================
AI-SLOP DENSITY RULES
============================================================
- Prioritize: impossible transformations, visual abundance, nested worlds, recursive creatures, absurd combinations, excessive detail, toy-store energy, internet-core aesthetics, dopamine-maximalism.
- Avoid: clean symbolism, minimalism, conceptual restraint, elegant composition, visual hierarchy.
- The image should feel like the model could not stop adding details.

============================================================
CHARACTER DESIGN RULES
============================================================
- All creatures should be cute, expressive, emotionally readable, funny, slightly confused, and slightly magical.
- Large eyes are encouraged. Rounded forms are encouraged. Smiling expressions are encouraged.

============================================================
COLOR RULES
============================================================
- Use vibrant colorful gradients.
- Prefer: neon pink, electric cyan, candy yellow, mint green, lavender purple, holographic rainbow gradients, pearlescent highlights, translucent bubble materials.
- The image should feel like a premium toy or mascot.

============================================================
SIGNALS INTEGRATION REQUIREMENT
============================================================
- You must incorporate the provided selected signals of the day into the central graphic and list them in the metadata.

============================================================
FIXED VISUAL LANGUAGE & ESTHETICS (CRITICAL)
============================================================

Every artwork must strictly adhere to the following visual constraints:
- CUTE CARTOON ILLUSTRATION AESTHETIC: The style is a whimsical, playful 2D digital vector cartoon illustration or doodle graphic. It must have entirely flat color fills with absolutely NO gradients, NO 3D shading, and NO lighting effects. Bold, clean, crisp black ink outlines must encircle every single character, mascot, object, and nested detail, giving it a classic clean cartoon line-art finish.
- NO STICKER OUTLINES: Absolutely NO external white border, NO thick white outline, and NO sticker cutlines around the creature. The outer edges of the creature must blend cleanly and directly into the solid black background.
- SMILING FACES ON EVERYTHING: Every single creature, animal, character, and INANIMATE OBJECT (like cups, sacks, lottery tickets, balls, planets, game controllers, stars) must have big shiny black expressive cartoon eyes, blushing pink cheeks, and a happy goofy smile.
- COLOR PALETTE: Saturated pastel and vibrant pop colors (such as candy yellow, soft pink, electric cyan, mint green, lavender purple). All colors must be applied as completely flat, solid fills with NO gradients, NO shadows, and NO highlights.
- SOLID PITCH-BLACK CANVAS: The entire background/canvas must be 100% solid pitch-black (hex #000000). There must be no gradients or patterns in the background, only solid black, so it can be printed on a t-shirt directly.
- STRICTLY FORBIDDEN: Monochrome art, black and white only, photographic realism, scary/gothic/dark elements, thin sketchy lines, text/letters, background scenery/landscapes, color gradients, shadows, 3D clay/plastic rendering, or a non-black background.

============================================================
OUTPUT FORMAT
============================================================

Return a JSON object with this exact structure:

{
  "date": "YYYY-MM-DD",
  "data_signals_used": ["A detailed list of the selected signals. For each signal, format it as 'Source Name: specific details' (e.g. 'UPI Weird News: Man solves two Rubik\\'s cubes...'). The Source Name MUST be one of: 'UPI Weird News', 'Oddity Central', 'Wikipedia Top Search', 'Optimist Daily', 'Good News Network', 'Polymarket Trending', 'Top Song', 'Wikipedia On this Day', or 'Google News'."],
  "data_signals_used_summarized": ["A summarized list of the selected signals, using exactly 3-4 words per signal, formatted as a clear and parsable list of strings."],
  "essence": "A brief sentence summarizing the thematic essence of the day.",
  "title": "A funny, cute title of 3-4 words maximum.",
  "image_prompt": "Highly detailed prompt to generate the complete visual artwork in a vertical 3:4 ratio. The prompt MUST start with: 'An isolated single cute AI-slop morphing artwork on a 100% solid pitch-black background. 2D vector cartoon illustration style, flat color fills, absolutely NO color gradients, and NO shading. Bold, clean, crisp black outlines around every character, creature, and object. Absolutely NO external white borders, and NO sticker cutlines. Absolutely NO text, NO letters, NO words, NO numbers, NO logos, and NO borders in the entire image. The entire background is completely solid pitch-black.' Following this, the prompt must detail a continuous, weird, morphing chain or network of cute characters, mascots, and objects that surrealistically blend into one another (without a single dominant or central element). Describe the absurd chain of cute morphing objects and recursive creatures representing each of the 5+ daily news signals (e.g. how the news is transformed: e.g. a warrior signal morphed into a cute dragon, which morphs into a vinyl record, which morphs into a singing star). The prompt must emphasize infinite visual abundance, recursive creatures, nested worlds inside the forms (like tiny smiling faces, food items, bubbles, planets, or vehicles), flat pop/pastel colors with no shading or highlights (using solid pink, cyan, purple, mint green, and yellow), and large goofy smiling eyes on everything. The entire background must be pure solid black.",
  "interpretive_statement": "A paragraph explaining the artwork's concept. Explain how the 5 selected daily signals were transformed through cute object chains into the unified mega-creature."
}
`;

  console.log('[Art Generator] Synthesizing headlines via Gemini gemini-2.5-pro...');
  const synthResponse = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: `${systemInstruction}\n\nSELECTED SIGNALS TO INCORPORATE:\n${JSON.stringify({ date: dateString, selected_signals: selectedSignals }, null, 2)}`,
    config: {
      responseMimeType: 'application/json',
    }
  });

  const parsedResult = JSON.parse(synthResponse.text);
  console.log('[Art Generator] Gemini Synthesis Custom Output:', JSON.stringify(parsedResult, null, 2));

  return parsedResult;
}

export async function generateImageFromPrompt(prompt, lotNumber, headlineStr) {
  console.log(`--- GENERATING IMAGE FROM PROMPT FOR DRAFT ${lotNumber} ---`);

  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error('Gemini API key or Google Cloud Project not configured.');
  }

  const isGeminiKey = !!process.env.GEMINI_API_KEY;
  const ai = isGeminiKey
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
      });

  const outputDir = join(__dir, '../public/artwork');
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `lot-${lotNumber}.png`;
  const filePath = join(outputDir, fileName);
  const localUrl = `/public/artwork/${fileName}`;

  console.log('[Art Generator] Generating image using Vertex AI Imagen 4 (imagen-4.0-generate-001)...');
  const response = await ai.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt: prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: '3:4',
      outputMimeType: 'image/png',
    },
  });

  const imageBytes = response?.generatedImages?.[0]?.image?.imageBytes;
  if (imageBytes) {
    const buffer = Buffer.from(imageBytes, 'base64');
    return await saveAndUploadArtwork(buffer, lotNumber, headlineStr, prompt, filePath, localUrl);
  } else {
    throw new Error('Empty image bytes received from Imagen API.');
  }
}
