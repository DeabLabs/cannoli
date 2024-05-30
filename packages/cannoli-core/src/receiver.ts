export interface Receiver {
    createHook(isMock: boolean): Promise<string | Error>;
    getHookResponse(hookId: string, isMock: boolean, shouldContinueWaiting: () => boolean): Promise<string | Error>;
}

