export class SpeechToText {
    constructor() {
        this.recognition = null;
        if (typeof window !== 'undefined') {
            const speechWindow = window;
            const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
            if (SpeechRecognition) {
                this.recognition = new SpeechRecognition();
                if (this.recognition) {
                    this.recognition.lang = 'ru-RU';
                    this.recognition.continuous = false;
                    this.recognition.interimResults = true;
                }
            }
            else {
                console.error('SpeechRecognition not supported in this browser.');
            }
        }
    }
    start(onResult) {
        if (!this.recognition)
            return;
        this.recognition.onresult = (event) => {
            const speechEvent = event;
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
