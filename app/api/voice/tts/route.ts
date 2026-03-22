// app/api/voice/tts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/app/api/middleware/auth';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  // Authentication check
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { text } = await request.json();
  
  // Generate TTS audio
  const outputFileName = `tts-${Date.now()}.mp3`;
  const outputFile = `/tmp/${outputFileName}`;
  
  try {
    // Generate the audio file using edge-tts
    await execAsync(`python3 -m edge_tts --voice ru-RU-DmitryNeural --text "${text}" --write-media ${outputFile}`);
    
    // Read the file buffer
    const audioBuffer = await fs.readFile(outputFile);
    
    // Cleanup
    await fs.unlink(outputFile).catch(() => {});
    
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length.toString(),
      }
    });
  } catch (error) {
    console.error('TTS generation error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
