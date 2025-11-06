import rgbHex from "rgb-hex";

export type ValueOf<T> = T[keyof T];

export class FPSCounter {
    public frameCount: number = 0;
    private frames: number[] = [];

    public tick() {
        const now = performance.now();
        this.frames.push(now);

        // Remove frames older than 1 second
        while (this.frames.length > 0 && this.frames[0] !== undefined && this.frames[0] <= now - 1000) {
            this.frames.shift();
        }

        this.frameCount = this.frames.length;
    }
}

export class EventEmitter<T> {
    private handlers: { [eventName in keyof T]?: ((value: T[eventName]) => void)[] }

    constructor() {
        this.handlers = {}
    }

    emit<K extends keyof T>(event: K, value: T[K]): void {
        this.handlers[event]?.forEach(h => h(value));
    }

    on<K extends keyof T>(event: K, handler: (value: T[K]) => void): void {
        if (!this.handlers[event]) {
            this.handlers[event] = [handler];
        } else {
            this.handlers[event].push(handler);
        }
    }
}

export function getHexFromCSSColor(color: string) {
    let d = document.createElement("div");
    d.style.color = color;
    document.body.appendChild(d);
    const rgb = window.getComputedStyle(d).color;

    return "#" + rgbHex(rgb);
}

export function* chunks(arr: any[], n: number) {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}