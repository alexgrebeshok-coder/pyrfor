export declare class LiveActivity {
    private bot;
    private chatId;
    private minIntervalMs;
    private maxLength;
    private messageId;
    private currentText;
    private lastUpdateAt;
    private pendingText;
    private flushTimer;
    constructor(bot: any, chatId: number, opts?: {
        minIntervalMs?: number;
        maxLength?: number;
    });
    start(initialText: string): Promise<void>;
    update(text: string): Promise<void>;
    private _flush;
    append(line: string): Promise<void>;
    complete(finalText: string, deleteAfterMs?: number): Promise<void>;
}
//# sourceMappingURL=live-activity.d.ts.map