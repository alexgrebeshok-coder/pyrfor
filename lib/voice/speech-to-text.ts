// lib/voice/speech-to-text.ts
export class SpeechToText {
  private recognition: SpeechRecognition | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        if (this.recognition) {
          this.recognition.lang = 'ru-RU';
          this.recognition.continuous = false;
          this.recognition.interimResults = true;
        }
      } else {
        console.error('SpeechRecognition not supported in this browser.');
      }
    }
  }

  start(onResult: (text: string, isFinal: boolean) => void) {
    if (!this.recognition) return;

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      const isFinal = event.results[0].isFinal;
      onResult(transcript, isFinal);
    };

    this.recognition.start();
  }

  stop() {
    if (this.recognition) {
      this.recognition.stop();
    }
  }
}
