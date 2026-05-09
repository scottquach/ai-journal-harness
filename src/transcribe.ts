import { OpenAI, toFile } from 'openai';
import type { BotContext } from './bot-setup.js';

type TranscriberOptions = {
  apiKey?: string;
};

type TranscribeVoice = (ctx: BotContext) => Promise<string>;

function createTranscriber({ apiKey }: TranscriberOptions = {}): TranscribeVoice {
  let openai: OpenAI | undefined;

  return async function transcribeVoice(ctx: BotContext): Promise<string> {
    if (!openai) {
      openai = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
    }
    const fileId = ctx.message?.voice?.file_id;
    if (!fileId) {
      throw new Error('Voice message is missing a file id');
    }
    const fileLink = await ctx.telegram.getFileLink(fileId);

    const response = await fetch(fileLink.href);
    if (!response.ok) {
      throw new Error(`Failed to download voice file: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const file = await toFile(buffer, 'voice.ogg', { type: 'audio/ogg' });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });

    return transcription.text;
  };
}

export { createTranscriber };
export type { TranscriberOptions, TranscribeVoice };
