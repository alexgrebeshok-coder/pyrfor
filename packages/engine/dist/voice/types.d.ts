export type VoiceCommandAction = 'navigate' | 'showStatus' | 'addTask' | 'back';
export interface VoiceCommand {
    action: VoiceCommandAction;
    path?: string;
    project?: string;
}
//# sourceMappingURL=types.d.ts.map