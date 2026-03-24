// lib/voice/speech-to-text.ts
type SpeechRecognitionConstructor = new () => SpeechRecognition;
type BrowserWindowWithSpeechRecognition = Window & typeof globalThis & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type SpeechRecognitionAlternative = {
  transcript: string;
};

type SpeechRecognitionResult = ArrayLike<SpeechRecognitionAlternative> & {
  isFinal: boolean;
};

type SpeechRecognitionResultEvent = Event & {
  results: ArrayLike<SpeechRecognitionResult>;
};

export class SpeechToText {
  private recognition: SpeechRecognition | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const speechWindow = window as BrowserWindowWithSpeechRecognition;
      const SpeechRecognition =
        speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
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

    this.recognition.onresult = (event: Event) => {
      const speechEvent = event as SpeechRecognitionResultEvent;
      const transcript = speechEvent.results[0][0].transcript;
      const isFinal = speechEvent.results[0].isFinal;
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
