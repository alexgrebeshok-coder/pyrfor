export interface SseFrame {
  event?: string;
  data: string;
}

export function parseSseFrames(text: string): { frames: SseFrame[]; remainder: string } {
  const parts = text.split('\n\n');
  const remainder = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const block of parts) {
    if (!block) continue;
    const lines = block.split('\n');
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    const frame: SseFrame = { data: dataLines.join('\n') };
    if (event !== undefined) frame.event = event;
    frames.push(frame);
  }
  return { frames, remainder };
}
