// components/voice/voice-button.tsx
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SpeechToText } from '../../lib/voice/speech-to-text';
import { parseVoiceCommand } from '../../lib/voice/commands';
import { VoiceCommand } from '../../lib/voice/types';

// Simplified helper for demo purposes. 
// In a real app, this would integrate with the dashboard's command/action registry.
function executeCommand(command: VoiceCommand, router: any) {
  console.log('Executing command:', command);
  switch (command.action) {
    case 'navigate':
      if (command.path) router.push(command.path);
      break;
    case 'addTask':
      // Trigger modal or push to /tasks/new
      router.push('/tasks/new');
      break;
    case 'back':
      router.back();
      break;
    case 'showStatus':
      // Trigger a status lookup modal or toast
      console.log('Showing status for:', command.project);
      break;
  }
}

export function VoiceButton() {
  const [isListening, setIsListening] = useState(false);
  const router = useRouter();

  const handleVoice = () => {
    const stt = new SpeechToText();
    
    stt.start((text, isFinal) => {
      console.log('Transcript:', text);
      
      if (isFinal) {
        const command = parseVoiceCommand(text);
        if (command) {
          executeCommand(command, router);
        }
        setIsListening(false);
      }
    });
    
    setIsListening(true);
  };

  return (
    <button
      onClick={handleVoice}
      className={`fixed bottom-4 right-4 w-14 h-14 rounded-full shadow-lg transition-all duration-300 ${
        isListening ? 'bg-red-600 animate-pulse' : 'bg-blue-600 hover:bg-blue-700'
      } text-white`}
    >
      {isListening ? '⏹' : '🎤'}
    </button>
  );
}
